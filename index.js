// init project
const express = require("express");
const nodemailer = require("nodemailer");
const bp = require("body-parser");
const moment = require("moment");
const { Pool, Client } = require("pg");

// Firebase config
const serviceAccount = require("./serviceAccountKey.json");
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// App config
const app = express();
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;

const DEFAULT_AVATAR =
  "https://user-images.githubusercontent.com/79369571/182101394-89e63593-11a1-4aed-8ec5-9638d9c62a81.png";

// GUEST
const pool = new Pool({
  connectionString:
    "postgres://Leanhdung2881999:CkXPLgAV6Zj0@calm-truth-683750.cloud.neon.tech/main?options=project%3Dcalm-truth-683750&sslmode=require",
  ssl: {
    rejectUnauthorized: false,
  },
});

// Get user info from database with jwt firebase token
const fetchUserInfo = async (token) => {
  console.log("token", { token });

  try {
    // 1) Extracts token
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log("decodedToken", { decodedToken });

    const { email, uid } = decodedToken;

    // 2) Fetches userInfo in a mock function
    const userRes = await pool.query(
      'SELECT * FROM public."User" WHERE email=$1',
      [email]
    );

    let users = userRes.rows;
    if (!users || users.length === 0) {
      try {
        const insertUserRes = await pool.query(
          'INSERT INTO public."User" (uuid, name, email, avatar) VALUES ($1, $2, $3, $4) RETURNING *',
          [uid, email, email, decodedToken.picture ?? DEFAULT_AVATAR]
        );
        users = insertUserRes.rows;
      } catch (error) {
        const userRes2 = await pool.query(
          'SELECT * FROM public."User" WHERE email=$1',
          [email]
        );

        users = userRes2.rows;
      }
    }

    // 3) Return hasura variables
    return users;
  } catch (error) {
    console.log({ error });
    return error;
  }
};

// GET: Hasura user information
app.get("/", async (request, response) => {
  try {
    // Extract token from request
    let token = request.get("Authorization");
    token = token.replace(/^Bearer\s/, "");

    // Fetch user_id that is associated with this token
    const users = await fetchUserInfo(token);

    let hasuraVariables = {};

    if (users.length > 0) {
      hasuraVariables = {
        "X-Hasura-Role": "user",
        "X-Hasura-User-Id": `${users[0].id}`,
      };
    }

    // Return appropriate response to Hasura
    response.json(hasuraVariables);
  } catch (error) {
    response.json({ error });
  }
});

// GET: trigger webhook get or create user when login
app.get("/webhook", async (request, response) => {
  // Extract token from request
  let token = request.get("Authorization");
  token = token.replace(/^Bearer\s/, "");

  // Fetch user_id that is associated with this token
  const user = await fetchUserInfo(token);

  // response.json({ token, user });

  let hasuraVariables = {};

  if (user.length > 0) {
    hasuraVariables = {
      "X-Hasura-Role": "user",
      "X-Hasura-User-Id": `${user[0].id}`,
    };
  }

  // Return appropriate response to Hasura
  response.json(hasuraVariables);
});

// POST: Callback for sign in with apple
app.post("/callback", async (request, response) => {
  const redirect = `intent://callback?${new URLSearchParams(
    request.body
  ).toString()}#Intent;package=com.perfectbudget.app;scheme=signinwithapple;end`;

  response.redirect(307, redirect);
});

// GET: Send report
app.get("/send_report", async (request, response) => {
  require("../send_mail.js")();

  response.json({ result: "OK" });
});

// GET: Send mail nhac tra tien dinh ky
app.all("/send_mail_to_borrowers", async (request, response) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      // user: "<fill-gmail>@gmail.com",
      // pass: "<fill-password>",
    },
  });

  // 1. Get contracts
  const needPayTodayContracts = await pool.query(
    'SELECT * FROM public."Contract" WHERE status = $1 AND pay_date <= $2',
    ["Borrowing", new Date()]
  );

  needPayTodayContracts = res.rows;

  if (!needPayTodayContracts || needPayTodayContracts.length === 0) {
    response.json({ result: "OK" });
    return;
  }

  // 2. Send mail
  for (const needPayTodayContract of needPayTodayContracts) {
    const emailBorrower = needPayTodayContract.email_borrower;
    const emailLender = needPayTodayContract.email_lender;
    // Send mail
    transporter
      .sendMail({
        from: '"Perfect Budget App" <perfectbudget.app@gmail.com>',
        to: emailBorrower,
        subject: `Por favor regresa el dinero a ${emailLender}`,
        html: `
          Hola ${emailBorrower},

          Por favor regresa el dinero a ${emailLender}.
        `,
      })
      .catch(console.error);

    // Wait 1sec
    await new Promise((r) => setTimeout(r, 1000));

    response.json({ result: "OK" });
  }
});

// GET: Send mail invite if user not exist
app.post("/send_mail_invite", async (request, response) => {
  // 1. get email can gui
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "<fill-gmail>@gmail.com",
      pass: "<fill-password>",
    },
  });

  const emailBorrower = request.body.event.data.new.email_borrower;
  const emailLender = request.body.event.data.new.email_lender;

  const queryRes = await pool.query(
    'SELECT * FROM public."User" WHERE email=$1',
    [emailBorrower]
  );

  const users = queryRes.rows;

  if (!users || users.length === 0) {
    transporter
      .sendMail({
        from: '"Perfect Budget App" <perfectbudget.app@gmail.com>',
        to: emailBorrower,
        subject: `Confirmar ${emailLender}`,
        html: `
          ${emailLender}
          https://timivietnam.github.io/monsey/ 
        `,
      })
      .catch(console.error);
  }

  response.json({ result: "OK" });
});

// listen for requests :)
app.listen(port, function () {
  console.log("Your app is listening on port " + port);
});

// Export the Express API
module.exports = app;
