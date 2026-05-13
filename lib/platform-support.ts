export function posixJobControlSupported(): boolean {
	// SIGSTOP/SIGCONT for cooperative pause/resume of child processes are POSIX semantics.
	// Windows (and some embedded targets) do not implement them for Node child processes.
	return process.platform !== "win32";
}
