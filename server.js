require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

app.post("/send-order", async (req, res) => {
    try {
        const telegramUrl =
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

        await fetch(telegramUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: req.body.message,
                parse_mode: "Markdown"
            })
        });

        res.json({
            success: true
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running");
});