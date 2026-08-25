import {
	AxiomJSTransport,
	ConsoleTransport,
	Logger,
	type Transport,
} from "@axiomhq/logging";
import axiomClient from "@/lib/axiom/axiom";

const axiomDataset = import.meta.env.VITE_PUBLIC_AXIOM_DATASET;

const transports: [Transport, ...Transport[]] = [
	new ConsoleTransport({
		prettyPrint: process.env.NODE_ENV !== "production",
	}),
];

// Ship logs to Axiom only when it's configured; without credentials the
// transport would fire a failing fetch on every log line.
if (axiomClient && axiomDataset) {
	transports.push(
		new AxiomJSTransport({
			axiom: axiomClient,
			dataset: axiomDataset,
		}),
	);
}

export const logger = new Logger({ transports });
