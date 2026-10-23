import { useEffect, useState } from "react";
import { Alert, Avatar, Box, Button, Card, CardContent, CardHeader, Chip, Container, Stack, Typography } from "@mui/material";
import TableChartOutlined from "@mui/icons-material/TableChartOutlined";
import PercentOutlined from "@mui/icons-material/PercentOutlined";
import UploadFileOutlined from "@mui/icons-material/UploadFileOutlined";
import RestoreOutlined from "@mui/icons-material/RestoreOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import { loadSheets, useDefault, useFile } from "../../lib/sheets.js";
import { ColorModeButton } from "../shared/theme.jsx";

const SHEETS = [
  { key: "rateSheet", title: "Rate sheet", icon: TableChartOutlined, blurb: "Lanes with the minimum charge and rate per mile for each equipment type.", missing: "No rate sheet. Pick the Final Bid .xlsx." },
  { key: "tempSurcharges", title: "Temporary surcharges", icon: PercentOutlined, blurb: "Percentage added to the linehaul, by lane and equipment.", missing: "None. Quotes will leave out temporary surcharges." },
];

function describe(key, x, missing) {
  if (!x) return missing;
  const count = key === "rateSheet" ? `${x.lanes.length.toLocaleString()} lanes` : `${x.list.length} surcharges`;
  return `${x.isDefault ? "Default" : "Your file"}: ${x.fileName}, ${count}` + (x.isDefault ? "." : `, loaded ${new Date(x.loadedAt).toLocaleDateString()}.`);
}

function SheetCard({ sheet, value, onChange }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const Icon = sheet.icon;
  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      onChange(await useFile(sheet.key, file));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const reset = async () => {
    onChange(await useDefault(sheet.key));
    setError(null);
  };
  return (
    <Card>
      <CardHeader
        avatar={<Avatar variant="rounded" sx={{ bgcolor: "primary.main", width: 32, height: 32 }}><Icon fontSize="small" /></Avatar>}
        title={sheet.title}
        subheader={sheet.blurb}
        action={value && <Chip size="small" color={value.isDefault ? "default" : "primary"} label={value.isDefault ? "Default" : "Your file"} />}
        sx={{ "& .MuiCardHeader-title": { textTransform: "none", letterSpacing: 0, fontSize: 15 } }}
      />
      <CardContent>
        <Typography id={`${sheet.key}Status`} variant="body2" color={value ? "text.secondary" : "warning.main"} sx={{ mb: 1.5 }}>
          {describe(sheet.key, value, sheet.missing)}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button component="label" variant="outlined" size="small" startIcon={<UploadFileOutlined />} disabled={busy}>
            {busy ? "Reading…" : "Use a different file (.xlsx)"}
            <input id={`${sheet.key}File`} type="file" accept=".xlsx" hidden onChange={pick} />
          </Button>
          <Button id={`${sheet.key}Default`} size="small" startIcon={<RestoreOutlined />} onClick={reset} hidden={!value || value.isDefault} sx={{ display: !value || value.isDefault ? "none" : undefined }}>
            Back to default
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function App() {
  const [sheets, setSheets] = useState(null);
  useEffect(() => { loadSheets().then(setSheets); }, []);
  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Stack direction="row" spacing={1.5} sx={{ mb: 3, alignItems: "center" }}>
        <Avatar variant="rounded" sx={{ bgcolor: "primary.main" }}><SettingsOutlined /></Avatar>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Data &amp; settings</Typography>
          <Typography variant="body2" color="text.secondary">Shipment quote sidebar</Typography>
        </Box>
        <ColorModeButton />
      </Stack>
      <Stack spacing={2}>
        {sheets && SHEETS.map((s) => (
          <SheetCard key={s.key} sheet={s} value={sheets[s.key]} onChange={(v) => setSheets((all) => ({ ...all, [s.key]: v }))} />
        ))}
        <Typography variant="caption" color="text.secondary">
          The defaults are the Siemens sheets that ship with the extension. A file you pick here replaces a default until you click Back to default.
        </Typography>
      </Stack>
    </Container>
  );
}
