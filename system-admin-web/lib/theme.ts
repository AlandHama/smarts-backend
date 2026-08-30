import { createTheme } from '@mui/material/styles';

export const adminTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#8b7dff' },
    secondary: { main: '#52c7f5' },
    background: { default: '#0b1020', paper: '#121a2c' },
    success: { main: '#45d5a2' },
    warning: { main: '#f4bf69' },
    error: { main: '#ff7180' },
  },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', h1: { fontWeight: 800 }, h2: { fontWeight: 750 }, h3: { fontWeight: 750 } },
  shape: { borderRadius: 14 },
  components: {
    MuiCard: { styleOverrides: { root: { border: '1px solid rgba(148,163,184,.14)', backgroundImage: 'linear-gradient(145deg, rgba(24,35,58,.98), rgba(18,26,44,.98))' } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none', fontWeight: 700, borderRadius: 10 } } },
    MuiOutlinedInput: { styleOverrides: { root: { background: 'rgba(7,12,26,.44)' } } },
    MuiTableCell: { styleOverrides: { head: { color: '#91a0b8', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase' }, root: { borderColor: 'rgba(148,163,184,.12)' } } },
  },
});

