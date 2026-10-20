// Pure (client-safe) Vehicle options + label helper — shared by the forms, the list and
// the server validation in contactVehicle.js.
export const VEHICLES = [
  { value: "two_wheeler", label: "Two Wheeler" },
  { value: "four_wheeler", label: "Four Wheeler" },
];
export const _VEHICLE_SET = new Set(VEHICLES.map((v) => v.value));
export function vehicleLabel(value) {
  return VEHICLES.find((v) => v.value === value)?.label || "";
}
