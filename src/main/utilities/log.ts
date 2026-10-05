import {
  appendFileSync,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
export function logger(file: string): (error: unknown) => void {
  return (error) => {
    try {
      if (existsSync(file) && statSync(file).size > 2 * 1024 * 1024) {
        if (existsSync(file + ".1")) unlinkSync(file + ".1");
        renameSync(file, file + ".1");
      }
      appendFileSync(
        file,
        `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`,
      );
    } catch {
      console.error("Unable to write application log");
    }
  };
}
