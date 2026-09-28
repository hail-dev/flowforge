import express from "express";

const app = express();
const port = Number(process.env.API_PORT ?? 3001);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "flowforge-api",
        time: new Date().toISOString(),
    });
});

app.listen(port, () => {
    console.log(`flowforge-api listening on http://localhost:${port}`);
});