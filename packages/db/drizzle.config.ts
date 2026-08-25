import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/schema/index.ts",
	dialect: "postgresql",
	casing: "snake_case",
	dbCredentials: {
		url: process.env.POSTGRES_URL ?? "postgres://dev:dev@localhost:5435/app",
	},
});
