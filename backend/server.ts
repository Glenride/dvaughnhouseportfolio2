import express, { type Request, type Response } from "express";
import authRouter from "./routes/authController";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authRouter);

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Auth service listening on port ${PORT}`);
  });
}

export default app;
