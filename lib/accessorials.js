// Accessorial charges from "FY 2025 Siemens FTL Accessorial Schedule". The schedule is static,
// so it lives here instead of being loaded.
//
// `how` says what each one is detected from. Items are only ticked when the email or the lane
// says so; anything we can't know up front (team, drop trailer without a mention, and so on)
// stays unticked for the broker to decide. Detention, layover, TONU, straps over 10 and permits
// happen after the load is booked, so they're not quoted here.

export const ACCESSORIALS = [
  { id: "sameDay", label: "Same-day pickup (within 6 hours)", amount: 100, how: '"READY NOW" in the email, with a pickup date of today or none' },
  { id: "weekendPickup", label: "Weekend pickup", amount: 200, how: "Pickup date is a Saturday or Sunday" },
  { id: "holidayPickup", label: "Holiday pickup", amount: 350, how: "Pickup date is one of the six listed holidays" },
  { id: "afterHoursPickup", label: "After-hours pickup (before 6am / after 6pm)", amount: 250, how: "Pickup time in the email" },
  { id: "weekendDelivery", label: "Weekend delivery", amount: 200, how: "Delivery date in the email; otherwise flagged if the estimated delivery lands on a weekend" },
  { id: "holidayDelivery", label: "Holiday delivery", amount: 350, how: "Delivery date in the email; otherwise flagged if the estimated delivery lands on a holiday" },
  { id: "afterHoursDelivery", label: "After-hours delivery (before 6am / after 6pm)", amount: 250, how: "Delivery time in the email" },
  { id: "tarp", label: "Tarp (flatbed / single-drop / step deck)", amount: 100, how: '"tarp" in the email on flatbed or single-drop equipment' },
  { id: "tarpDoubleDrop", label: "Tarp, double-drop", amount: 150, how: '"tarp" in the email on double-drop equipment' },
  { id: "overDim", label: "Over dimensional (flatbed / single-drop / step deck)", amount: 200, how: '"oversize", "over dimensional", "wide load" or "permit load" in the email' },
  { id: "overDimDoubleDrop", label: "Over dimensional, double-drop", amount: 250, how: "As above, on double-drop equipment" },
  { id: "stopOff", label: "Stop-off (per stop)", amount: 75, perUnit: "stops", how: "More than one delivery address in the email" },
  { id: "hazmat", label: "Hazmat", amount: 50, how: '"hazmat", "hazardous", a UN number, a hazard class or "placard" in the email' },
  { id: "team", label: "Team driver", amount: 100, perMileOver1000: 0.1, how: '"team driver", "team service" or "team required" in the email' },
  { id: "dropTrailer", label: "Drop trailer", amount: 200, how: '"drop trailer" or "drop and hook" in the email' },
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
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const dayName = (d) => d.toLocaleDateString("en-US", { weekday: "long", month: "numeric", day: "numeric" });

// Rough transit: same day under 250 miles, then about 500 miles a day for one driver.
export function estimateDelivery(pickupDate, miles) {
  if (!pickupDate || !miles) return null;
  const days = miles < 250 ? 0 : Math.ceil(miles / 500);
  return new Date(pickupDate.getFullYear(), pickupDate.getMonth(), pickupDate.getDate() + days);
}

// Returns Map(id -> { checked, reason }). checked=false entries are hints to look at.
export function detectAccessorials(details, { miles = null, equipment = "", now = new Date() } = {}) {
  const out = new Map();
  const tick = (id, reason) => out.set(id, { checked: true, reason });
  const hint = (id, reason) => out.has(id) || out.set(id, { checked: false, reason });
  if (!details) return out;
  const { pickup, delivery, flags = {} } = details;
  const eq = equipment.toLowerCase();
  const doubleDrop = /double/.test(eq);
  const openDeck = /flatbed|single|step/.test(eq);

  if (details.readyNow && (!pickup?.date || sameDay(pickup.date, now))) tick("sameDay", "email says READY NOW");

  if (pickup?.date) {
    if (isWeekend(pickup.date)) tick("weekendPickup", `pickup ${dayName(pickup.date)}`);
    if (isHoliday(pickup.date)) tick("holidayPickup", `pickup ${dayName(pickup.date)} is a holiday`);
  }
  if (isAfterHours(pickup?.minutes)) tick("afterHoursPickup", "pickup time is outside 6am–6pm");

  if (delivery?.date) {
    if (isWeekend(delivery.date)) tick("weekendDelivery", `delivery ${dayName(delivery.date)}`);
    if (isHoliday(delivery.date)) tick("holidayDelivery", `delivery ${dayName(delivery.date)} is a holiday`);
  } else {
    const est = estimateDelivery(pickup?.date, miles);
    if (est && isWeekend(est)) hint("weekendDelivery", `estimated delivery ${dayName(est)}, check`);
    if (est && isHoliday(est)) hint("holidayDelivery", `estimated delivery ${dayName(est)} is a holiday, check`);
  }
  if (isAfterHours(delivery?.minutes)) tick("afterHoursDelivery", "delivery time is outside 6am–6pm");

  if (flags.tarp) {
    if (doubleDrop) tick("tarpDoubleDrop", 'email mentions "tarp"');
    else if (openDeck) tick("tarp", 'email mentions "tarp"');
    else hint("tarp", 'email mentions "tarp", but the equipment is not open deck');
  }
  if (flags.overDimensional) {
    if (doubleDrop) tick("overDimDoubleDrop", "email says oversize / over dimensional");
    else tick("overDim", "email says oversize / over dimensional");
  }
  if (details.stops > 0) tick("stopOff", `${details.stops} extra delivery address${details.stops > 1 ? "es" : ""} in the email`);
  if (details.hazmat) tick("hazmat", "email mentions hazmat");
  if (flags.team) tick("team", "email asks for a team");
  if (flags.dropTrailer) tick("dropTrailer", "email mentions a drop trailer");
  return out;
}

export function accessorialAmount(item, { miles, stops = 1 }) {
  if (item.perUnit === "stops") return item.amount * Math.max(1, stops);
  if (item.perMileOver1000 && miles > 1000) return item.perMileOver1000 * miles;
  return item.amount;
}
