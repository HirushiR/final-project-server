// rn-infra/routes/auth.mjs
import express from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt"; // Import JWT strategy
import crypto from "crypto";
import jwt from "jsonwebtoken"; // Import jsonwebtoken
import db from "../db/index.mjs";
import config from "../config/index.mjs"; // Import config for JWT secret/expiry

const router = express.Router();

// --- Prepare DB Statements ---
const getUserStmt = db.prepare(
  "SELECT id, username, hashed_password, salt FROM users WHERE username = ?"
); // Select ID too
const getUserByIdStmt = db.prepare(
  "SELECT id, username FROM users WHERE id = ?"
); // For JWT verification
const insertUserStmt = db.prepare(
  "INSERT INTO users (username, hashed_password, salt) VALUES (?, ?, ?)"
);

// --- Passport Local Strategy (for initial /login/password check) ---
passport.use(
  "local-login",
  new LocalStrategy(function verify(username, password, cb) {
    // Give it a name to distinguish from JWT
    console.log(`[Local Strategy] Attempting login for user: ${username}`);
    try {
      const row = getUserStmt.get(username);
      if (!row) {
        /* ... user not found handling ... */
        console.log(
          `[Local Strategy] Login failed: User not found - ${username}`
        );
        return cb(null, false, { message: "Incorrect username or password." });
      }

      crypto.pbkdf2(
        password,
        row.salt,
        310000,
        32,
        "sha256",
        function (err, hashedPassword) {
          if (err) {
            return cb(err);
          }
          if (
            !row.hashed_password ||
            !crypto.timingSafeEqual(row.hashed_password, hashedPassword)
          ) {
            /* ... password incorrect handling ... */
            console.log(
              `[Local Strategy] Login failed: Incorrect password for user ${username}`
            );
            return cb(null, false, {
              message: "Incorrect username or password.",
            });
          }
          // Password matches! Return user object for JWT generation
          const user = { id: row.id, username: row.username };
          console.log(
            `[Local Strategy] Credentials verified for user: ${username} (ID: ${user.id})`
          );
          return cb(null, user); // Pass user object to the route handler
        }
      );
    } catch (dbErr) {
      console.error(
        `[Local Strategy] Database error during login for ${username}:`,
        dbErr
      );
      return cb(dbErr);
    }
  })
);

// --- Passport JWT Strategy (for verifying tokens on protected routes) ---
const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), // Extracts "Bearer <token>"
  secretOrKey: config.JWT_SECRET, // The secret key to verify the signature
  // Optional: issuer, audience, algorithms etc.
};

passport.use(
  "jwt",
  new JwtStrategy(jwtOptions, function (jwt_payload, done) {
    // Give it a name
    console.log("[JWT Strategy] Verifying token for user ID:", jwt_payload.sub); // 'sub' is standard for subject (user ID)
    try {
      // Find user in DB based on ID stored in JWT payload ('sub')
      const user = getUserByIdStmt.get(jwt_payload.sub);

      if (user) {
        console.log(
          `[JWT Strategy] User found: ${user.username} (ID: ${user.id})`
        );
        // User found, token is valid (signature and expiry checked by passport-jwt)
        return done(null, user); // Attach user object { id, username } to req.user
      } else {
        console.log(
          `[JWT Strategy] User ID ${jwt_payload.sub} not found in DB.`
        );
        // User not found in DB (e.g., deleted after token was issued)
        return done(null, false);
      }
    } catch (dbErr) {
      console.error(
        `[JWT Strategy] Database error during token verification:`,
        dbErr
      );
      return done(dbErr, false);
    }
  })
);

// --- REMOVE Session Serialization/Deserialization ---
// passport.serializeUser(...);
// passport.deserializeUser(...);

// --- Authentication Routes ---

// GET /login - No longer meaningful for JWT, returns 405
router.get("/login", (req, res) => {
  res.status(405).json({
    message: "GET /login is not used with JWT auth. Use POST /login/password.",
  });
});

// POST /login/password - Authenticate and Issue JWT
router.post("/login/password", (req, res, next) => {
  // Use the named 'local-login' strategy, disable sessions
  passport.authenticate(
    "local-login",
    { session: false },
    (err, user, info) => {
      if (err) {
        return next(err);
      }
      if (!user) {
        // Authentication failed (user not found or password mismatch from strategy)
        console.log(
          `Login POST failed: ${
            info?.message || "No user returned from local strategy"
          }`
        );
        return res
          .status(401)
          .json({ success: false, message: info?.message || "Login failed" });
      }

      // --- User authenticated, now generate JWT ---
      const payload = {
        sub: user.id, // Subject (Standard JWT claim for user ID)
        username: user.username, // Include username if needed client-side
        // iat: Math.floor(Date.now() / 1000), // Issued at (optional, added by jwt.sign)
        // Add other claims if needed (e.g., roles)
      };

      try {
        const token = jwt.sign(
          payload,
          config.JWT_SECRET,
          { expiresIn: config.JWT_EXPIRES_IN } // Use expiry from config
        );

        console.log(`JWT issued for user: ${user.username}`);
        // Send token and user info back to client
        return res.json({
          success: true,
          message: "Login successful",
          token: token, // The generated JWT
          user: { id: user.id, username: user.username }, // User info (without sensitive data)
        });
      } catch (jwtError) {
        console.error("Error signing JWT:", jwtError);
        return next(new Error("Could not generate authentication token."));
      }
    }
  )(req, res, next);
});

// POST /logout - REMOVE THIS ENDPOINT
// router.post('/logout', ...);

// GET /signup - Placeholder/Info endpoint (remains the same)
router.get("/signup", (req, res) => {
  res.status(405).json({
    message: "GET not supported for signup. Use POST to create an account.",
  });
});

// POST /signup - Create user and Issue JWT
router.post("/signup", function (req, res, next) {
  const { username, password } = req.body;
  if (!username || !password) {
    /* ... validation ... */
    return res
      .status(400)
      .json({ success: false, message: "Username and password are required." });
  }

  const salt = crypto.randomBytes(16);
  crypto.pbkdf2(
    password,
    salt,
    310000,
    32,
    "sha256",
    function (err, hashedPassword) {
      if (err) {
        return next(err);
      }

      try {
        const info = insertUserStmt.run(username, hashedPassword, salt);
        const newUser = {
          id: info.lastInsertRowid,
          username: username,
        };
        console.log(
          `User signed up successfully: ${newUser.username} (ID: ${newUser.id})`
        );

        // --- Generate JWT for the new user ---
        const payload = { sub: newUser.id, username: newUser.username };
        try {
          const token = jwt.sign(payload, config.JWT_SECRET, {
            expiresIn: config.JWT_EXPIRES_IN,
          });
          console.log(`JWT issued for new user: ${newUser.username}`);
          // Respond with success, token, and user info
          res.status(201).json({
            success: true,
            message: "Signup successful.",
            token: token,
            user: newUser,
          });
        } catch (jwtError) {
          console.error("Error signing JWT after signup:", jwtError);
          // User created, but token failed - this is tricky.
          // Maybe respond with success but no token and ask user to login?
          // For simplicity, return error here.
          return next(
            new Error(
              "Account created, but could not generate authentication token. Please try logging in."
            )
          );
        }
        // --- End JWT Generation ---
      } catch (dbErr) {
        if (dbErr.code === "SQLITE_CONSTRAINT_UNIQUE") {
          /* ... handle duplicate ... */
          console.log(`Signup failed: Username already exists - ${username}`);
          return res
            .status(409)
            .json({ success: false, message: "Username already taken." });
        }
        console.error("Signup DB Error:", dbErr);
        return next(
          new Error(`Database error during signup: ${dbErr.message}`)
        );
      }
    }
  );
});

export default router;
