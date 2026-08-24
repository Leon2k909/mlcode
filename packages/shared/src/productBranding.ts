const ML_CODE_PROJECT_NAMES = new Set([
  "t3 code",
  "t3code",
  "ml code",
  "mlcode",
  "pingdotgg/t3code",
  "github.com/pingdotgg/t3code",
  "leon2k909/mlcode",
  "github.com/leon2k909/mlcode",
]);

/** Normalize the known legacy and current repository labels for this product. */
export function displayMlCodeProjectName(label: string): string {
  return ML_CODE_PROJECT_NAMES.has(label.trim().toLowerCase()) ? "ML Code" : label;
}
