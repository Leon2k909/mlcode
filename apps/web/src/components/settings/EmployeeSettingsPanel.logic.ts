export const EMPLOYEE_MODEL_AUTO = "__employee_auto__";
export const EMPLOYEE_MODEL_FOLLOW_THREAD = "__employee_follow_thread__";
export const EMPLOYEE_MODEL_CUSTOM = "__employee_custom_model__";

type EmployeeModelLabelOption = {
  readonly slug: string;
  readonly name: string;
};

export function getEmployeeModelPickerLabel(
  value: string,
  modelOptions: ReadonlyArray<EmployeeModelLabelOption>,
): string {
  if (value === EMPLOYEE_MODEL_AUTO) return "Auto";
  if (value === EMPLOYEE_MODEL_FOLLOW_THREAD) return "Follow chat model";
  if (value === EMPLOYEE_MODEL_CUSTOM) return "Custom model slug…";
  return modelOptions.find((model) => model.slug === value)?.name ?? value;
}
