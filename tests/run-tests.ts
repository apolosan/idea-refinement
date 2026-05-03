import { run as runIoTests } from "./lib/io.test.ts";
import { run as runMarkerParserTests } from "./lib/marker-parser.test.ts";
import { run as runPathUtilsTests } from "./lib/path-utils.test.ts";
import { run as runPathGuardsTests } from "./lib/path-guards.test.ts";
import { run as runManifestTests } from "./lib/manifest.test.ts";
import { run as runPostHocCheckTests } from "./lib/post-hoc-check.test.ts";
import { run as runValidationTests } from "./lib/validation.test.ts";
import { run as runResponseValidatorTests } from "./lib/response-validator.test.ts";
import { run as runValidatorCheckTests } from "./lib/validator-check.test.ts";
import { run as runUiMonitorTests } from "./lib/ui-monitor.test.ts";
import { run as runRunnerTests } from "./lib/runner.test.ts";
import { run as runNumberGeneratorTests } from "./lib/number-generator.test.ts";
import { run as runPromptsTests } from "./lib/prompts.test.ts";
import { run as runArtifactGuardTests } from "./lib/artifact-guard.test.ts";
import { run as runSpinnerTests } from "./lib/spinner.test.ts";
import { run as runWorkflowTests } from "./lib/workflow.test.ts";

async function run(): Promise<void> {
	const suites = [
		{ name: "io", run: runIoTests },
		{ name: "marker-parser", run: runMarkerParserTests },
		{ name: "path-utils", run: runPathUtilsTests },
		{ name: "path-guards", run: runPathGuardsTests },
		{ name: "manifest", run: runManifestTests },
		{ name: "post-hoc-check", run: runPostHocCheckTests },
		{ name: "validation", run: runValidationTests },
		{ name: "response-validator", run: runResponseValidatorTests },
		{ name: "validator-check", run: runValidatorCheckTests },
		{ name: "ui-monitor", run: runUiMonitorTests },
		{ name: "runner", run: runRunnerTests },
		{ name: "number-generator", run: runNumberGeneratorTests },
		{ name: "prompts", run: runPromptsTests },
		{ name: "artifact-guard", run: runArtifactGuardTests },
		{ name: "spinner", run: runSpinnerTests },
		{ name: "workflow", run: runWorkflowTests },
	];

	let passed = 0;
	let failed = 0;

	for (const suite of suites) {
		try {
			await suite.run();
			passed++;
		} catch (error) {
			failed++;
			console.error(`\n✗ Suite "${suite.name}" failed:`);
			console.error(error);
		}
	}

	console.log(`\n========================================`);
	console.log(`Suites: ${passed} passed, ${failed} failed out of ${suites.length} total`);
	console.log(`========================================`);

	if (failed > 0) {
		process.exitCode = 1;
	}
}

run().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
