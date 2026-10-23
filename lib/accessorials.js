// Accessorial charges from "FY 2025 Siemens FTL Accessorial Schedule". The schedule is static,
// so it lives here instead of being loaded. Date and time based ones are detected automatically;
// the rest are checkboxes in the panel.

export const ACCESSORIALS = [
  { id: "weekendPickup", label: "Weekend pickup", amount: 200, auto: true },
  { id: "holidayPickup", label: "Holiday pickup", amount: 350, auto: true },
  { id: "afterHoursPickup", label: "After-hours pickup (before 6am / after 6pm)", amount: 250, auto: true },
  { id: "weekendDelivery", label: "Weekend delivery", amount: 200, auto: true },
  { id: "holidayDelivery", label: "Holiday delivery", amount: 350, auto: true },
  { id: "afterHoursDelivery", label: "After-hours delivery (before 6am / after 6pm)", amount: 250, auto: true },
  { id: "sameDay", label: "Same-day pickup (within 6 hours)", amount: 100 },
  { id: "tarp", label: "Tarp (flatbed / single-drop / step deck)", amount: 100 },
  { id: "tarpDoubleDrop", label: "Tarp, double-drop", amount: 150 },
  { id: "overDim", label: "Over dimensional (flatbed / single-drop / step deck)", amount: 200 },
  { id: "overDimDoubleDrop", label: "Over dimensional, double-drop", amount: 250 },
  { id: "stopOff", label: "Stop-off (per stop)", amount: 75, perUnit: "stops" },
  { id: "hazmat", label: "Hazmat", amount: 50, auto: true },
  { id: "team", label: "Team driver", amount: 100, perMileOver1000: 0.1 },
  { id: "dropTrailer", label: "Drop trailer", amount: 200 },
];

// Only these holidays count, per the schedule.
export function isHoliday(date) {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const nthWeekday = (month, weekday, n) => {
    const first = new Date(y, month, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  };
  const lastMonday = (month) => {
    const last = new Date(y, month + 1, 0);
    return last.getDate() - ((last.getDay() + 6) % 7);
  };
  return (
    (m === 0 && d === 1) ||
    (m === 4 && d === lastMonday(4)) ||
    (m === 6 && d === 4) ||
    (m === 8 && d === nthWeekday(8, 1, 1)) ||
    (m === 10 && d === nthWeekday(10, 4, 4)) ||
    (m === 11 && d === 25)
  );
}

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;
const isAfterHours = (minutes) => minutes != null && (minutes < 6 * 60 || minutes > 18 * 60);

// details.pickup / details.delivery: { date: Date|null, minutes: number|null }
export function detectAccessorials(details) {
  const on = new Set();
  const { pickup, delivery } = details;
  if (pickup?.date) {
    if (isWeekend(pickup.date)) on.add("weekendPickup");
    if (isHoliday(pickup.date)) on.add("holidayPickup");
  }
  if (isAfterHours(pickup?.minutes)) on.add("afterHoursPickup");
  if (delivery?.date) {
    if (isWeekend(delivery.date)) on.add("weekendDelivery");
    if (isHoliday(delivery.date)) on.add("holidayDelivery");
  }
  if (isAfterHours(delivery?.minutes)) on.add("afterHoursDelivery");
  if (details.hazmat) on.add("hazmat");
  return on;
}

export function accessorialAmount(item, { miles, stops = 1 }) {
  if (item.perUnit === "stops") return item.amount * stops;
  if (item.perMileOver1000 && miles > 1000) return item.perMileOver1000 * miles;
  return item.amount;
}
