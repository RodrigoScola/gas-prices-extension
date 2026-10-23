import { useState } from "react";
import {
  Alert, AlertTitle, Avatar, Box, Button, Card, CardContent, CardHeader, Checkbox, Chip, CircularProgress, Collapse,
  Divider, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import LocalShippingOutlined from "@mui/icons-material/LocalShippingOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import MailOutlined from "@mui/icons-material/MailOutlined";
import PlaceOutlined from "@mui/icons-material/PlaceOutlined";
import FlagOutlined from "@mui/icons-material/FlagOutlined";
import RouteOutlined from "@mui/icons-material/RouteOutlined";
import LocalGasStationOutlined from "@mui/icons-material/LocalGasStationOutlined";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import AutoAwesomeOutlined from "@mui/icons-material/AutoAwesomeOutlined";
import ExpandMore from "@mui/icons-material/ExpandMore";
import ContentCopyOutlined from "@mui/icons-material/ContentCopyOutlined";
import { FEATURES } from "../../config.js";
import { money } from "../../lib/quote.js";
import { ColorModeButton } from "../shared/theme.jsx";
import { useSidebar } from "./useSidebar.js";

// The rate sheet's equipment names are long; the dropdown shows short ones.
const SHORT = { "dry van/tractor trailer": "Dry van", "flatbed rate inclusive of 48' & 53'": "Flatbed (48'/53')", "single-drop": "Single-drop / step deck", "refrigerated truck": "Reefer" };
const shortEquipment = (t) => SHORT[t.toLowerCase()] || t;

// Label/value rows. Rendered as <dl> so the end-to-end test can read them.
function Facts({ id, rows }) {
  return (
    <Box component="dl" id={id} sx={{ display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 1.5, rowGap: 0.5, m: 0 }}>
      {rows.map(([label, value, strong]) => [
        <Typography key={`${label}-t`} component="dt" variant="body2" color="text.secondary">{label}</Typography>,
        <Typography key={`${label}-d`} component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere", fontWeight: strong ? 700 : 400, color: value == null ? "warning.main" : undefined }}>
          {value ?? "not found"}
        </Typography>,
      ])}
    </Box>
  );
}

function Section({ icon: Icon, title, action, children }) {
  return (
    <Card>
      <CardHeader
        avatar={<Icon fontSize="small" color="primary" />}
        title={title}
        action={action}
        sx={{ "& .MuiCardHeader-avatar": { mr: 1 } }}
      />
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Header({ reference }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ px: 0.5, pb: 1.5, alignItems: "center" }}>
      <Avatar variant="rounded" sx={{ bgcolor: "primary.main", width: 34, height: 34 }}>
        <LocalShippingOutlined fontSize="small" />
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>Shipment quote</Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">{reference || "Siemens FTL"}</Typography>
      </Box>
      <ColorModeButton />
      <Tooltip title="Data & settings">
        <IconButton id="openSettings" size="small" aria-label="Data & settings" onClick={() => chrome.runtime.openOptionsPage()}>
          <SettingsOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function QuoteCard({ quote }) {
  const [copied, setCopied] = useState(false);
  const rows = quote.lines.slice(0, -1);
  const copy = async () => {
    await navigator.clipboard.writeText(quote.lines.map(([l, v]) => `${l}: ${v}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Card id="quote" sx={{ borderColor: quote.complete ? "success.main" : "divider", borderWidth: quote.complete ? 1.5 : 1 }}>
      <CardContent sx={{ pt: 1.75 }}>
        <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">{quote.complete ? "Quote total" : "Partial total"}</Typography>
            <Typography variant="h4" sx={{ fontWeight: 750, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: quote.complete ? "text.primary" : "text.disabled" }}>
              {money(quote.total)}
            </Typography>
          </Box>
          <Stack spacing={0.75} sx={{ alignItems: "flex-end" }}>
            {quote.complete
              ? <Chip size="small" color="success" icon={<CheckCircleOutline />} label="Ready" />
              : <Chip size="small" color="warning" icon={<ErrorOutline />} label={`${quote.problems.length} to fix`} />}
            <Tooltip title={copied ? "Copied" : "Copy the quote"}>
              <span><IconButton size="small" aria-label="Copy the quote" onClick={copy} disabled={!rows.length}><ContentCopyOutlined fontSize="inherit" /></IconButton></span>
            </Tooltip>
          </Stack>
        </Stack>

        {rows.length > 0 && <Divider sx={{ my: 1.25 }} />}
        <Box component="dl" id="quoteDetails" sx={{ m: 0, display: "grid", gridTemplateColumns: "1fr auto", rowGap: 0.5 }}>
          {quote.lines.map(([label, value, cls]) => [
            <Typography key={`${label}-t`} component="dt" variant="body2" color={cls ? "text.primary" : "text.secondary"} sx={cls ? { display: "none" } : null}>{label}</Typography>,
            <Typography key={`${label}-d`} component="dd" variant="body2" sx={{ m: 0, textAlign: "right", fontVariantNumeric: "tabular-nums", ...(cls ? { display: "none" } : null) }}>{value}</Typography>,
          ])}
        </Box>

        <Box id="problems" hidden={quote.complete} sx={{ mt: 1.5 }}>
          <Alert severity="warning" variant="outlined" icon={<ErrorOutline fontSize="small" />}>
            <AlertTitle sx={{ fontSize: 13, mb: 0.25 }}>Quote is incomplete</AlertTitle>
            <Box component="ul" id="problemList" sx={{ m: 0, pl: 2 }}>
              {quote.problems.map(([where, what]) => <li key={where + what}><b>{where}:</b> {what}</li>)}
            </Box>
          </Alert>
        </Box>

        {quote.notes.length > 0 && (
          <Box component="ul" id="notes" sx={{ mt: 1.25, mb: 0, pl: 2.25, color: "text.secondary", fontSize: 12 }}>
            {quote.notes.map(([where, what]) => <li key={where + what}><b>{where}:</b> {what}</li>)}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function EmailCard({ email, loadSample, applyEmail }) {
  const d = email.details;
  const fmt = (x) => x && [x.date?.toLocaleDateString(), x.minutes != null ? `${String(Math.floor(x.minutes / 60)).padStart(2, "0")}:${String(x.minutes % 60).padStart(2, "0")}` : null].filter(Boolean).join(" ");
  const place = (p) => p && `${p.city}, ${p.state}${p.zip ? " " + p.zip : ""}`;
  const rows = d ? [
    ["Reference", d.reference],
    ["Pickup", d.origin ? `${place(d.origin)}${d.originFromSignature ? " (sender's address)" : ""}` : null],
    ["Delivery", place(d.destination) ?? null],
    ["Consignee", d.consignee ? [d.consignee.name, d.consignee.street].filter(Boolean).join(", ") : null],
    ["Contact", d.consignee?.contact ?? null],
    ["Weight", d.weight ? `${d.weight.toLocaleString()} lbs` : null],
    ["Pieces", d.pieces],
    ["Value of goods", d.value != null ? money(d.value) : null],
    ["Equipment", d.equipment],
    ["Ready", d.readyNow ? "Ready now" : null],
    ["Pickup date", fmt(d.pickup) || null],
    ["Delivery date", fmt(d.delivery) || null],
    ["Sender", d.sender],
  ].filter(([label, value]) => value != null || ["Reference", "Pickup", "Delivery", "Weight", "Equipment"].includes(label)) : [];
  const note = email.source ? `Read from: ${email.source}.` : email.note || "Looking for an open email…";

  return (
    <Section icon={MailOutlined} title="Email" action={email.source && <Chip size="small" variant="outlined" label={email.source} />}>
      <Typography id="captureNote" variant="body2" color={email.source ? "text.secondary" : "warning.main"} sx={{ mb: d ? 1 : 0, display: email.source ? "none" : "block" }}>
        {note}
      </Typography>
      <Box id="devTools" hidden={!FEATURES.sampleEmail} sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Chip size="small" color="warning" variant="outlined" label="DEV" />
          <Button id="loadSample" size="small" variant="outlined" onClick={loadSample}>Sample email</Button>
        </Stack>
      </Box>
      <TextField
        id="email" multiline minRows={4} maxRows={10} placeholder="Paste an email here (development only)."
        sx={{ mb: 1, display: FEATURES.emailTextBox ? undefined : "none" }} hidden={!FEATURES.emailTextBox}
        defaultValue="" onChange={(e) => applyEmail(e.target.value, "pasted text")}
        slotProps={{ htmlInput: { style: { fontFamily: "ui-monospace, monospace", fontSize: 12 } } }}
      />
      {d && <Facts id="details" rows={rows} />}
      {!d && <Box component="dl" id="details" sx={{ m: 0 }} />}
    </Section>
  );
}

function LaneCard({ lane, miles, quote, equipmentTypes, setLaneField, typeMiles }) {
  const milesNote = miles.busy ? "Working out the route…"
    : miles.error ? ""
    : miles.source === "route" ? `Driving miles from the ${miles.precision}.`
    : miles.source === "email" ? "Miles from the email." : "";
  return (
    <Section icon={RouteOutlined} title="Lane">
      <Stack spacing={1.25}>
        <TextField
          id="origin" label="Pickup" placeholder="City, ST" value={lane.origin} onChange={(e) => setLaneField("origin", e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><PlaceOutlined fontSize="small" /></InputAdornment> } }}
        />
        <TextField
          id="destination" label="Delivery" placeholder="City, ST" value={lane.destination} onChange={(e) => setLaneField("destination", e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><FlagOutlined fontSize="small" /></InputAdornment> } }}
        />
        <Stack direction="row" spacing={1.25}>
          <TextField
            id="equipment" select label="Equipment" value={lane.equipment} onChange={(e) => setLaneField("equipment", e.target.value)}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={{ flex: 1.6 }}
          >
            {equipmentTypes.map((t) => <option key={t} value={t}>{shortEquipment(t)}</option>)}
          </TextField>
          <TextField
            id="miles" label="Miles" type="number" value={miles.value} onChange={(e) => typeMiles(e.target.value)} sx={{ flex: 1 }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: 0, step: 1 }, input: { endAdornment: miles.busy ? <InputAdornment position="end"><CircularProgress size={14} /></InputAdornment> : null } }}
          />
        </Stack>
        <Typography id="milesNote" variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>{milesNote}</Typography>
        <Box sx={{ display: quote.lane ? "flex" : "none", alignItems: "center", gap: 0.75, color: "success.main" }}>
          <CheckCircleOutline sx={{ fontSize: 16 }} />
          <Typography id="laneResult" variant="body2" sx={{ fontWeight: 600 }}>{quote.lane?.text || ""}</Typography>
        </Box>
      </Stack>
    </Section>
  );
}

function FuelCard({ diesel, quote, typeDiesel }) {
  const text = quote.fuel ? quote.fuel.text : diesel.error ? "" : "Getting this week's diesel price from EIA…";
  return (
    <Section icon={LocalGasStationOutlined} title="Fuel surcharge" action={quote.fuel && <Chip size="small" color="secondary" label={`${money(quote.fuel.perMile)}/mi`} />}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <TextField
          id="diesel" label="Diesel" type="number" value={diesel.value} onChange={(e) => typeDiesel(e.target.value)} sx={{ maxWidth: 150 }}
          slotProps={{
            inputLabel: { shrink: true }, htmlInput: { step: 0.001, min: 0 },
            input: {
              startAdornment: <InputAdornment position="start">$</InputAdornment>,
              endAdornment: diesel.busy ? <InputAdornment position="end"><CircularProgress size={14} /></InputAdornment> : <InputAdornment position="end">/gal</InputAdornment>,
            },
          }}
        />
        <Typography id="fuelResult" variant="caption" color={quote.fuel?.stale ? "warning.main" : "text.secondary"}>{text}</Typography>
      </Stack>
    </Section>
  );
}

function AccessorialRow({ a, onToggle }) {
  return (
    <Box
      component="label" className="acc" data-id={a.item.id} data-reason={a.found?.reason || ""} title={`Detected from: ${a.item.how}`}
      sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, py: 0.25, cursor: "pointer", borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }}
    >
      <Checkbox size="small" checked={a.checked} onChange={(e) => onToggle(a.item.id, e.target.checked)} sx={{ p: 0.5 }} />
      <Box sx={{ flex: 1, minWidth: 0, pt: 0.4 }}>
        <Typography variant="body2" className="acc-label">{a.item.label}</Typography>
        {a.found && (
          <Typography variant="caption" className={a.found.checked ? "auto" : "hint"} sx={{ display: "flex", alignItems: "center", gap: 0.4, color: a.found.checked ? "success.main" : "warning.main" }}>
            {a.found.checked ? <AutoAwesomeOutlined sx={{ fontSize: 12 }} /> : <InfoOutlined sx={{ fontSize: 12 }} />}
            {a.found.reason}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={{ pt: 0.4, fontVariantNumeric: "tabular-nums", color: a.checked ? "text.primary" : "text.secondary" }}>{money(a.amount)}</Typography>
    </Box>
  );
}

function AccessorialsCard({ quote, toggleAccessorial }) {
  const [showAll, setShowAll] = useState(false);
  const relevant = quote.accessorials.filter((a) => a.checked || a.found);
  const rest = quote.accessorials.filter((a) => !(a.checked || a.found));
  return (
    <Section icon={AutoAwesomeOutlined} title="Accessorials" action={<Chip size="small" variant="outlined" label={`${quote.accessorials.filter((a) => a.checked).length} added`} />}>
      <Box id="accessorials">
        {relevant.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Nothing detected in this email.</Typography>}
        {relevant.map((a) => <AccessorialRow key={a.item.id} a={a} onToggle={toggleAccessorial} />)}
        <Collapse in={showAll}>
          {rest.map((a) => <AccessorialRow key={a.item.id} a={a} onToggle={toggleAccessorial} />)}
        </Collapse>
      </Box>
      <Button size="small" onClick={() => setShowAll((s) => !s)} endIcon={<ExpandMore sx={{ transform: showAll ? "rotate(180deg)" : "none", transition: "transform .2s" }} />} sx={{ mt: 0.5, ml: -0.75 }}>
        {showAll ? "Hide the others" : `Show all ${quote.accessorials.length}`}
      </Button>
    </Section>
  );
}

export default function App() {
  const s = useSidebar();
  return (
    <Box sx={{ p: 1.5, maxWidth: 560, mx: "auto" }}>
      <Header reference={s.email.details?.reference} />
      <Stack spacing={1.25}>
        <QuoteCard quote={s.quote} />
        <EmailCard email={s.email} loadSample={s.loadSample} applyEmail={s.applyEmail} />
        <LaneCard lane={s.lane} miles={s.miles} quote={s.quote} equipmentTypes={s.equipmentTypes} setLaneField={s.setLaneField} typeMiles={s.typeMiles} />
        <FuelCard diesel={s.diesel} quote={s.quote} typeDiesel={s.typeDiesel} />
        <AccessorialsCard quote={s.quote} toggleAccessorial={s.toggleAccessorial} />
      </Stack>
    </Box>
  );
}
