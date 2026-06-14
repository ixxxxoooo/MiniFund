import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let out = "";
try {
  out = execFileSync(
    "/Users/liwenjiao/go/bin/go",
    ["test", "./internal/datasource/eastmoney/", "./services/", "./internal/model/"],
    { cwd: "/Users/liwenjiao/MiniFund", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  out = "EXIT=0\n" + out;
} catch (e) {
  out = "EXIT=" + (e.status ?? "?") + "\n--- stdout ---\n" + (e.stdout || "") + "\n--- stderr ---\n" + (e.stderr || "");
}
writeFileSync("/Users/liwenjiao/MiniFund/frontend/.gotest_out.txt", out);
console.log("WROTE");
