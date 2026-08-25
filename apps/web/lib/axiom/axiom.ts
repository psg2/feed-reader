import { Axiom } from "@axiomhq/js";

const token = import.meta.env.VITE_PUBLIC_AXIOM_TOKEN;

// Only construct the client when a token is configured — @axiomhq/js
// warns "Missing Axiom token" at construction time otherwise.
const axiomClient = token ? new Axiom({ token }) : null;

export default axiomClient;
