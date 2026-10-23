import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseEmail } from "../lib/email.js";
import { read, PRIVATE, skipUnless } from "./helpers.mjs";

const NOW = new Date(2026, 9, 23);
const parse = (text) => parseEmail(text, NOW);
const cityOf = (p) => p && { city: p.city, state: p.state, zip: p.zip };
const SIG = "\n\nWith best regards,\nSam Sender\n\nExample Shipper Inc.\n501 Fountain Parkway\nGrand Prairie, TX 75050, USA\n";

describe("Siemens-style unlabeled emails", () => {
  test("sample email: every field", () => {
    const d = parse(read("../sample/email-sample.txt"));
    assert.equal(d.reference, "3011500000-01A");
    assert.deepEqual(d.destination, { city: "Fort Worth", state: "TX", zip: "76111", street: "1200 Example Industrial Blvd" });
    assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050", street: "501 Fountain Parkway" });
    assert.equal(d.originFromSignature, true);
    assert.deepEqual(d.consignee, { name: "ACME ELECTRIC", street: "1200 Example Industrial Blvd", contact: "Jane Doe 555-010-0000" });
    assert.equal(d.value, 42500);
    assert.equal(d.pieces, "4 cs");
    assert.equal(d.weight, 2150);
    assert.equal(d.sender, "Sam Sender");
    assert.equal(d.equipment, "Dry van/tractor trailer");
    assert.equal(d.readyNow, true);
    assert.equal(d.pickup.date.getMonth(), 9);
    assert.equal(d.pickup.date.getDate(), 28);
    assert.equal(d.stops, 0);
    assert.equal(d.hazmat, false);
  });

  test("pickup is always the signature address, even when it comes first in the text", () => {
    const d = parse("REF 12345678-1\nACME\n1 Main St\nAUSTIN TX 78701" + SIG);
    assert.equal(d.origin.city, "Grand Prairie");
    assert.equal(d.destination.city, "Austin");
  });

  test("run-together city and state (ITASCAIL 60143)", () => {
    const d = parse("RDI\n1070 ARDMORE AVE\nITASCAIL 60143" + SIG);
    assert.deepEqual(cityOf(d.destination), { city: "Itasca", state: "IL", zip: "60143" });
  });

  test("zip+4 and a trailing USA are accepted", () => {
    assert.deepEqual(cityOf(parse("X\n1 A St\nDALLAS TX 75201-1234" + SIG).destination), { city: "Dallas", state: "TX", zip: "75201" });
    assert.deepEqual(cityOf(parse("X\n1 A St\nDallas, TX 75201, USA" + SIG).destination), { city: "Dallas", state: "TX", zip: "75201" });
  });

  test("multi-word and punctuated city names", () => {
    assert.equal(parse("X\n1 A St\nST. LOUIS MO 63101" + SIG).destination.city, "St. Louis");
    assert.equal(parse("X\n1 A St\nWINSTON-SALEM NC 27101" + SIG).destination.city, "Winston-Salem");
    assert.equal(parse("X\n1 A St\nO'FALLON MO 63366" + SIG).destination.city, "O'Fallon");
  });

  test("contact lines under the address: Attn, phone and email", () => {
    const d = parse("X\n1 A St\nDALLAS TX 75201\nAttn: Pat Lee\nPH# 214-555-0100\npat@example.com" + SIG);
    assert.equal(d.consignee.contact, "Pat Lee, PH# 214-555-0100, pat@example.com");
  });

  test("the reference line is not taken as the consignee name", () => {
    const d = parse("3011526620-23K\n1 A St\nDALLAS TX 75201" + SIG);
    assert.equal(d.consignee.name, null);
  });

  test("two addresses without a signature: pickup then delivery", () => {
    const d = parse("SHIPPER CO\n1 A St\nDALLAS TX 75201\n\nRECEIVER CO\n2 B St\nATLANTA GA 30303\n");
    assert.equal(d.origin.city, "Dallas");
    assert.equal(d.destination.city, "Atlanta");
    assert.equal(d.originFromSignature, false);
    assert.equal(d.stops, 0);
  });

  test("extra delivery addresses become stop-offs, duplicates don't", () => {
    const three = "A\n1 A St\nDALLAS TX 75201\n\nB\n2 B St\nAUSTIN TX 78701\n\nC\n3 C St\nWACO TX 76701" + SIG;
    assert.equal(parse(three).stops, 2);
    const dup = "A\n1 A St\nDALLAS TX 75201\n\nA again\n1 A St\nDALLAS TX 75201" + SIG;
    assert.equal(parse(dup).stops, 0);
  });
});

describe("real emails", () => {
  test("email 1 (MEI, Fort Worth)", { skip: skipUnless(PRIVATE.email1) }, () => {
    const d = parse(read(PRIVATE.email1));
    assert.equal(d.reference, "3011526620-23K");
    assert.deepEqual(d.destination, { city: "Fort Worth", state: "TX", zip: "76111", street: "2917 Chesser Boyer Rd" });
    assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050", street: "501 Fountain Parkway" });
    assert.equal(d.consignee.name, "MEI");
    assert.equal(d.consignee.contact, "Chris Green 682-380-9497");
    assert.equal(d.value, 185690);
    assert.equal(d.weight, 3600);
    assert.equal(d.pieces, "2 cs");
    assert.equal(d.sender, "Albert Harbin");
  });

  test("email 1 with its subject line", { skip: skipUnless(PRIVATE.email1Subject) }, () => {
    const d = parse(read(PRIVATE.email1Subject));
    assert.equal(d.reference, "3011526620-23K");
    assert.equal(d.equipment, "Dry van/tractor trailer");
    assert.equal(d.readyNow, true);
    assert.equal(d.pickup.date.getMonth(), 9);
    assert.equal(d.pickup.date.getDate(), 14);
  });

  test("email 2 (RDI, Itasca)", { skip: skipUnless(PRIVATE.email2) }, () => {
    const d = parse(read(PRIVATE.email2));
    assert.equal(d.reference, "3010759748-41K/42K/43K/44K");
    assert.deepEqual(d.destination, { city: "Itasca", state: "IL", zip: "60143", street: "1070 ARDMORE AVE" });
    assert.equal(d.origin.city, "Grand Prairie");
    assert.equal(d.consignee.name, "RDI Enclosures & Systems");
    assert.equal(d.consignee.contact, "PH#6303738084, brian dlugos@therdigroup.com");
    assert.equal(d.value, 132600);
    assert.equal(d.pieces, "4 pcs");
    assert.equal(d.weight, 7200);
    assert.equal(d.equipment, "Dry van/tractor trailer");
    assert.equal(d.pickup.date.getDate(), 14);
    assert.equal(d.readyNow, true);
    assert.equal(d.stops, 0);
  });
});

describe("labeled emails", () => {
  test("Pickup / Deliver to with dates and times", () => {
    const d = parse(read("../sample/email-labeled.txt"));
    assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050" });
    assert.deepEqual(d.destination, { city: "Pomona", state: "CA", zip: "91766" });
    assert.equal(d.equipment, "Dry van/tractor trailer");
    assert.equal(d.miles, 1420);
    assert.equal(d.weight, 38500);
    assert.equal(d.reference, "LOAD-4471");
    assert.equal(d.pickup.date.toDateString(), new Date(2026, 9, 31).toDateString());
    assert.equal(d.pickup.minutes, 19 * 60);
    assert.equal(d.delivery.date.toDateString(), new Date(2026, 10, 3).toDateString());
    assert.equal(d.delivery.minutes, 10 * 60);
    assert.equal(d.sender, "Sample Customer");
  });

  for (const [pickupLabel, deliveryLabel] of [["Origin", "Destination"], ["Shipper", "Consignee"], ["Ship from", "Ship to"], ["Pick up", "Delivery"]]) {
    test(`${pickupLabel} / ${deliveryLabel}`, () => {
      const d = parse(`${pickupLabel}: Memphis, TN 38103\n${deliveryLabel}: Columbus, OH 43215`);
      assert.deepEqual(cityOf(d.origin), { city: "Memphis", state: "TN", zip: "38103" });
      assert.deepEqual(cityOf(d.destination), { city: "Columbus", state: "OH", zip: "43215" });
    });
  }

  test("label with the address a few lines below it", () => {
    const d = parse("Shipper:\nBig Co\n100 Main St\nMemphis, TN 38103\n\nConsignee:\nSmall Co\n5 Elm\nColumbus, OH 43215");
    assert.equal(d.origin.city, "Memphis");
    assert.equal(d.destination.city, "Columbus");
  });

  test("labels win over the signature address", () => {
    const d = parse("Pickup: Memphis, TN 38103\nDeliver to: Columbus, OH 43215" + SIG);
    assert.equal(d.origin.city, "Memphis");
    assert.equal(d.destination.city, "Columbus");
  });

  test("lane sentences: 'to' and arrows", () => {
    for (const s of ["Dallas, TX to Atlanta, GA", "Dallas, TX -> Atlanta, GA", "Dallas, TX → Atlanta, GA"]) {
      const d = parse(`Need a truck ${s} next week`);
      assert.equal(d.origin?.state, "TX", s);
      assert.equal(d.destination?.state, "GA", s);
    }
  });

  test("Canadian provinces", () => {
    const d = parse("Pickup: Detroit, MI 48201\nDeliver to: Toronto, ON");
    assert.equal(d.destination.state, "ON");
  });
});

describe("fields", () => {
  test("equipment words", () => {
    const cases = {
      "53' reefer": "Refrigerated Truck", "refrigerated trailer": "Refrigerated Truck", "temp controlled": "Refrigerated Truck",
      "step deck": "Single-drop", "stepdeck": "Single-drop", "single drop": "Single-drop",
      "flatbed": "Flatbed Rate inclusive of 48' & 53'", "flat bed": "Flatbed Rate inclusive of 48' & 53'",
      "Van Load for 10/14": "Dry van/tractor trailer", "dry van": "Dry van/tractor trailer", "tractor trailer": "Dry van/tractor trailer",
    };
    for (const [text, type] of Object.entries(cases)) assert.equal(parse(text).equipment, type, text);
    assert.equal(parse("no trailer type mentioned").equipment, null);
    assert.equal(parse("advantage savings").equipment, null, "'van' inside a word doesn't count");
  });

  test("weight formats", () => {
    const cases = { "38,500 lbs": 38500, "3600lbs": 3600, "7200bs": 7200, "12000 pounds": 12000, "5000#": 5000, "1 lb": 1, "42,000.5 lbs": 42000.5 };
    for (const [text, w] of Object.entries(cases)) assert.equal(parse(text).weight, w, text);
    assert.equal(parse("no weight here").weight, null);
  });

  test("pieces formats", () => {
    const cases = { "2cs": "2 cs", "4pcs": "4 pcs", "10 pallets": "10 pallets", "3 skids": "3 skids", "1 crate": "1 crate", "6 boxes": "6 boxes", "12 plts": "12 plts" };
    for (const [text, p] of Object.entries(cases)) assert.equal(parse(text).pieces, p, text);
  });

  test("value of goods and miles", () => {
    assert.equal(parse("$185,690.00").value, 185690);
    assert.equal(parse("$ 1,000.50").value, 1000.5);
    assert.equal(parse("$500 tip").value, null, "needs cents to count as the value line");
    assert.equal(parse("approx 1,420 miles").miles, 1420);
    assert.equal(parse("781 loaded miles").miles, 781);
    assert.equal(parse("355 mi").miles, 355);
    assert.equal(parse("no distance").miles, null);
  });

  test("reference numbers", () => {
    const cases = {
      "3011526620-23K": "3011526620-23K",
      "Van Load READY NOW 3010759748-41K/42K/43K/44K": "3010759748-41K/42K/43K/44K",
      "PRO# 778899": "778899",
      "PO: 4500123456": "4500123456",
      "BOL 55-123": "55-123",
      "Ref: LOAD-4471": "LOAD-4471",
      "Order number A1B2C3": "A1B2C3",
    };
    for (const [text, ref] of Object.entries(cases)) assert.equal(parse(text).reference, ref, text);
    assert.equal(parse("Load available tomorrow").reference, null, "a word after 'load' isn't a reference");
  });

  test("READY NOW and the subject's load date", () => {
    const d = parse("Subject: Van Load for 11/02 READY NOW 123456789-1A");
    assert.equal(d.readyNow, true);
    assert.equal(d.pickup.date.getMonth(), 10);
    assert.equal(d.pickup.date.getDate(), 2);
    assert.equal(d.pickup.date.getFullYear(), 2026);
    assert.equal(parse("ready for pickup Monday").readyNow, false);
  });

  test("a labeled pickup date wins over the subject's date", () => {
    const d = parse("Subject: Van Load for 11/02\nPickup date: 11/05/2026");
    assert.equal(d.pickup.date.getDate(), 5);
  });

  test("hazmat words", () => {
    for (const s of ["HAZMAT", "hazardous materials", "UN1993", "UN 1203", "class 3", "Class 2.1", "placarded"]) assert.equal(parse(s).hazmat, true, s);
    for (const s of ["classic cars", "unhappy", "first class service"]) assert.equal(parse(s).hazmat, false, s);
  });

  test("keyword flags", () => {
    assert.equal(parse("needs tarps").flags.tarp, true);
    assert.equal(parse("tarped load").flags.tarp, true);
    assert.equal(parse("startpoint").flags.tarp, false);
    for (const s of ["oversize", "over dimensional", "over-width", "wide load", "permit load", "overdimensional"]) assert.equal(parse(s).flags.overDimensional, true, s);
    for (const s of ["team driver", "team service", "team required", "teams only"]) assert.equal(parse(s).flags.team, true, s);
    for (const s of ["our logistics team", "Team, please quote"]) assert.equal(parse(s).flags.team, false, s);
    for (const s of ["drop trailer", "dropped trailer", "drop and hook", "drop & hook"]) assert.equal(parse(s).flags.dropTrailer, true, s);
  });

  test("sender is the first line after the sign-off", () => {
    for (const s of ["Thanks,\nJo", "Thank you\nJo", "Regards,\n\nJo", "Sincerely,\nJo"]) assert.equal(parse(s).sender, "Jo", s);
    assert.equal(parse("no sign-off").sender, null);
  });
});

describe("robustness", () => {
  test("empty, null and junk input don't throw", () => {
    for (const input of ["", null, undefined, "   \n\n  ", "🚚🚚🚚", "x".repeat(100000)]) {
      const d = parseEmail(input, NOW);
      assert.equal(d.origin, null);
      assert.equal(d.destination, null);
      assert.equal(d.stops, 0);
    }
  });

  test("long pages parse fast (whole-page reads can be big)", () => {
    for (const big of ["x".repeat(200000), "word ".repeat(40000), "Dallas Fort Worth Big City ".repeat(8000)]) {
      const t = performance.now();
      parseEmail(big, NOW);
      assert.ok(performance.now() - t < 1000, `took ${Math.round(performance.now() - t)} ms`);
    }
  });

  test("Windows line endings and non-breaking spaces", () => {
    const text = read("../sample/email-sample.txt").replace(/\n/g, "\r\n").replace(/ /g, " ");
    const d = parse(text);
    assert.equal(d.destination.city, "Fort Worth");
    assert.equal(d.origin.city, "Grand Prairie");
    assert.equal(d.weight, 2150);
  });

  test("words that end in two capitals aren't read as City ST", () => {
    const d = parse("PLEASE CALL ME\nTHANKS FOR THE OK\nUSE GATE IN 12345");
    assert.equal(d.destination, null);
  });

  test("the inbox around a Gmail message doesn't confuse it", () => {
    const d = parse("Inbox 12\nStarred\nSent\n" + read("../sample/email-sample.txt"));
    assert.equal(d.destination.city, "Fort Worth");
  });
});
