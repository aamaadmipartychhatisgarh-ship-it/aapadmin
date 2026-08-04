// Single source of truth for the Worker Type enum — used by the Add/Edit
// worker form, the Workers list filter, export, and the Reports Engine
// module so every place that reads or writes worker_type agrees on the
// same value/label pairs.
export const WORKER_TYPES = [
  { value: "full_time", label: "Full Time Worker" },
  { value: "part_time", label: "Part Time Worker" },
  { value: "volunteer", label: "Volunteer" },
  { value: "office_staff", label: "Office Staff" },
  { value: "consultant", label: "Consultant" },
];

export const WORKER_TYPE_LABELS = Object.fromEntries(WORKER_TYPES.map((t) => [t.value, t.label]));
