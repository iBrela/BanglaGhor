import { createTheme, alpha } from "@mui/material/styles";
 
// ─── Dark colour tokens ───────────────────────────────────────────────────────
const D = {
  base:          "#071318",
  surface:       "#0D2029",
  raised:        "#112733",
  border:        "#1C3F4E",
  cyan:          "#00D4E8",
  cyanDim:       "#00A8BB",
  coral:         "#FF5F40",
  amber:         "#F5A623",
  teal:          "#2DD4BF",
  purple:        "#A78BFA",
  textPrimary:   "#E8F4F8",
  textSecondary: "#7BAFC0",
  textMuted:     "#3D6878",
};
 
// ─── Light colour tokens ──────────────────────────────────────────────────────
const L = {
  base:          "#EFF9FE",
  surface:       "#FFFFFF",
  raised:        "#F5FBFD",
  border:        "#C8E8F0",
  cyan:          "#2B7B8C",
  cyanDim:       "#246A77",
  coral:         "#E04B2A",
  amber:         "#D48A10",
  teal:          "#1A9E8A",
  purple:        "#7C5CC9",
  textPrimary:   "#0B1F23",
  textSecondary: "#647C82",
  textMuted:     "#9AB5BC",
};
 
// ─── Theme factory ────────────────────────────────────────────────────────────
const buildTheme = (C, mode) =>
  createTheme({
    palette: {
      mode,
      primary:    { main: C.cyan, dark: C.cyanDim, contrastText: mode === "dark" ? C.base : "#fff" },
      secondary:  { main: C.coral, contrastText: "#fff" },
      warning:    { main: C.amber },
      success:    { main: C.teal },
      info:       { main: C.purple },
      error:      { main: mode === "dark" ? "#F87171" : "#D94F35" },
      background: { default: C.base, paper: C.surface },
      text:       { primary: C.textPrimary, secondary: C.textSecondary, disabled: C.textMuted },
      divider:    C.border,
      action: {
        hover:    alpha(C.cyan, 0.08),
        selected: alpha(C.cyan, 0.14),
        focus:    alpha(C.cyan, 0.18),
      },
    },
 
    typography: {
      fontFamily: "'DM Sans', 'Roboto', Arial, sans-serif",
      h1: { fontWeight: 800, letterSpacing: "-0.03em" },
      h2: { fontWeight: 700, letterSpacing: "-0.02em" },
      h3: { fontWeight: 700, letterSpacing: "-0.015em" },
      h4: { fontWeight: 700, letterSpacing: "-0.01em" },
      h5: { fontWeight: 600 },
      h6: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600, letterSpacing: "0.01em" },
    },
 
    shape: { borderRadius: 10 },
 
    components: {
      MuiCssBaseline: {
        styleOverrides: `
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
          html, body, #root {
            background-color: ${C.base};
            color: ${C.textPrimary};
            scroll-behavior: smooth;
          }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: ${C.base}; }
          ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; transition: background 0.2s; }
          ::-webkit-scrollbar-thumb:hover { background: ${C.cyan}; }
          ::selection { background: rgba(0,212,232,0.3); color: #fff; }
          a { color: ${C.cyan}; text-decoration: none; }
          a:hover { color: ${C.teal}; }
        `,
      },
 
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(C.base, 0.85),
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderBottom: `1px solid ${C.border}`,
            boxShadow: "none",
            "&::after": {
              content: '""',
              position: "absolute",
              bottom: 0, left: 0, right: 0,
              height: "1px",
              background: `linear-gradient(90deg, transparent, ${alpha(C.cyan, 0.5)}, transparent)`,
            },
          },
        },
      },
 
      MuiToolbar: {
        styleOverrides: { root: { minHeight: "64px !important" } },
      },
 
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: "10px", fontWeight: 600, transition: "all 0.2s ease" },
          containedPrimary: {
            background: `linear-gradient(135deg, ${C.cyan} 0%, ${C.cyanDim} 100%)`,
            color: mode === "dark" ? C.base : "#fff",
            boxShadow: `0 0 16px ${alpha(C.cyan, 0.35)}`,
            "&:hover": {
              background: `linear-gradient(135deg, ${C.teal} 0%, ${C.cyan} 100%)`,
              boxShadow: `0 0 24px ${alpha(C.cyan, 0.5)}`,
              transform: "translateY(-1px)",
            },
            "&:active": { transform: "translateY(0)" },
          },
          outlinedPrimary: {
            borderColor: alpha(C.cyan, 0.5),
            color: C.cyan,
            "&:hover": {
              borderColor: C.cyan,
              backgroundColor: alpha(C.cyan, 0.08),
              boxShadow: `0 0 12px ${alpha(C.cyan, 0.2)}`,
            },
          },
          textPrimary: {
            color: C.textSecondary,
            "&:hover": { color: C.cyan, backgroundColor: alpha(C.cyan, 0.08) },
          },
        },
      },
 
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: "10px",
            transition: "all 0.2s ease",
            color: C.textSecondary,
            "&:hover": { backgroundColor: alpha(C.cyan, 0.1), color: C.cyan },
          },
        },
      },
 
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: "14px",
            transition: "all 0.25s ease",
            overflow: "hidden",
            "&:hover": {
              borderColor: alpha(C.cyan, 0.6),
              transform: "translateY(-4px)",
              boxShadow: `0 12px 40px ${alpha(C.cyan, 0.15)}`,
            },
          },
        },
      },
 
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: C.surface,
            backgroundImage: "none",
            border: `1px solid ${C.border}`,
          },
          elevation0: { border: "none" },
          elevation1: { boxShadow: `0 2px 16px ${alpha(C.base, 0.8)}` },
          elevation3: { boxShadow: `0 4px 24px ${alpha(C.base, 0.9)}` },
        },
      },
 
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: C.raised,
            borderRadius: "10px",
            color: C.textPrimary,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: C.border },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: alpha(C.cyan, 0.5) },
            "&.Mui-focused": { boxShadow: `0 0 0 3px ${alpha(C.cyan, 0.18)}` },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: C.cyan },
          },
          input: { "&::placeholder": { color: C.textMuted, opacity: 1 } },
        },
      },
 
      MuiInputLabel: {
        styleOverrides: {
          root: { color: C.textSecondary, "&.Mui-focused": { color: C.cyan } },
        },
      },
 
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: C.raised,
            border: `1px solid ${C.border}`,
            boxShadow: `0 8px 32px ${alpha(C.base, 0.9)}`,
            borderRadius: "12px",
          },
        },
      },
 
      MuiMenuItem: {
        styleOverrides: {
          root: {
            color: C.textPrimary,
            borderRadius: "8px",
            margin: "2px 6px",
            transition: "all 0.15s ease",
            "&:hover": { backgroundColor: alpha(C.cyan, 0.1), color: C.cyan },
            "&.Mui-selected": {
              backgroundColor: alpha(C.cyan, 0.15),
              color: C.cyan,
              "&:hover": { backgroundColor: alpha(C.cyan, 0.2) },
            },
          },
        },
      },
 
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: "8px", fontWeight: 600, fontSize: "0.75rem" },
          colorPrimary: {
            backgroundColor: alpha(C.cyan, 0.15),
            color: C.cyan,
            border: `1px solid ${alpha(C.cyan, 0.3)}`,
          },
          colorSecondary: {
            backgroundColor: alpha(C.coral, 0.15),
            color: C.coral,
            border: `1px solid ${alpha(C.coral, 0.3)}`,
          },
        },
      },
 
      MuiBadge: {
        styleOverrides: {
          badge: {
            backgroundColor: C.coral,
            color: "#fff",
            fontWeight: 700,
            boxShadow: `0 0 8px ${alpha(C.coral, 0.6)}`,
          },
        },
      },
 
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: C.surface,
            border: `1px solid ${C.border}`,
            backgroundImage: "none",
          },
        },
      },
 
      MuiDivider: {
        styleOverrides: { root: { borderColor: C.border } },
      },
 
      MuiAvatar: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(C.cyan, 0.2),
            color: C.cyan,
            border: `1px solid ${alpha(C.cyan, 0.3)}`,
            fontWeight: 700,
          },
        },
      },
 
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: C.raised,
            color: C.textPrimary,
            border: `1px solid ${C.border}`,
            borderRadius: "8px",
            fontSize: "0.78rem",
          },
          arrow: { color: C.raised },
        },
      },
 
      MuiTab: {
        styleOverrides: {
          root: {
            color: C.textSecondary,
            fontWeight: 600,
            textTransform: "none",
            "&.Mui-selected": { color: C.cyan },
          },
        },
      },
 
      MuiTabs: {
        styleOverrides: {
          indicator: {
            backgroundColor: C.cyan,
            boxShadow: `0 0 8px ${alpha(C.cyan, 0.5)}`,
            height: "3px",
            borderRadius: "3px 3px 0 0",
          },
        },
      },
 
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: "10px",
            margin: "2px 0",
            transition: "all 0.2s ease",
            color: C.textSecondary,
            "&:hover": { backgroundColor: alpha(C.cyan, 0.08), color: C.cyan },
            "&.Mui-selected": {
              backgroundColor: alpha(C.cyan, 0.14),
              color: C.cyan,
              borderLeft: `3px solid ${C.cyan}`,
              "&:hover": { backgroundColor: alpha(C.cyan, 0.2) },
            },
          },
        },
      },
 
      MuiSkeleton: {
        styleOverrides: {
          root: { backgroundColor: alpha(C.border, 0.5) },
        },
      },
    },
  });
 
export const darkTheme  = buildTheme(D, "dark");
export const lightTheme = buildTheme(L, "light");
 
// Legacy default export so any existing imports of { theme } still work
export const theme = darkTheme;