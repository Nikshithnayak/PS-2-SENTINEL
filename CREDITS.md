# Credits, Licenses & Attributions — SENTINEL

SENTINEL respects open-source and open-data licenses. Where published packages exist, SENTINEL installs them directly rather than vendoring code. Repositories marked `SKIP` or excluded for license compatibility are explicitly noted.

---

## 1. Open-Source Repositories & Packages

| Project / Package | Author / Org | License | How Used in SENTINEL |
|---|---|---|---|
| [the-momentum/open-wearables](https://github.com/the-momentum/open-wearables) | Momentum | MIT | Optional self-hosted wearable ingestion service; schema & streaming Apple Health XML parser patterns |
| [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) | Cloudflare, Inc. | Apache-2.0 | Caregiver inbound/outbound email reply pattern (`workers/inbox`) with RFC 5322 threading |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | Yi-Ting Chiu & Contributors | MIT (Live2D assets excluded) | Reference architecture for voice check-in VAD/ASR/TTS & interruption state machine |
| [medplum/medplum](https://github.com/medplum/medplum) (`@medplum/fhirtypes`) | Medplum | Apache-2.0 | Installed package `@medplum/fhirtypes` for FHIR R4 `Patient`, `Observation`, `Flag`, `Bundle` export |
| [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Next Level Builder | MIT | Design intelligence query script used to establish healthcare accessibility & typography system |
| [nexu-io/open-design](https://github.com/nexu-io/open-design) | Nexu / OpenDesign | Apache-2.0 | `DESIGN.md` portable design system structure and design-review checklist |
| [garrytan/gstack](https://github.com/garrytan/gstack) | Garry Tan | MIT | Engineering process workflows & `DESIGN.md` frontmatter format |
| [motiondivision/motion](https://github.com/motiondivision/motion) | Motion B.V. | MIT | Installed `motion` npm package for accessible reduced-motion-aware UI transitions |
| [ruucm/shadergradient](https://github.com/ruucm/shadergradient) | ruucm | MIT | Installed `@shadergradient/react` for lazy-loaded landing hero & subtle patient status aura |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | Poimandres | MIT | Installed `@react-three/fiber` + `three` for landing-page 3D pulse waveform visual |
| [dashersw/liquid-glass-js](https://github.com/dashersw/liquid-glass-js) | Armagan Amcalar | MIT | Design pattern reference for floating glass navigation/sheets/toasts |
| [paper-design/shaders](https://github.com/paper-design/shaders) (`@paper-design/shaders-react`) | Paper Design | Apache-2.0 | Optional Apache-2.0 shader package; note `paper-design/liquid-logo` demo repo (PolyForm Shield 1.0.0) is **NOT** copied or redistributed |
| [21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp) | 21st.dev | ISC | UI component prototyping workflow reference |
| [rmyndharis/antigravity-skills](https://github.com/rmyndharis/antigravity-skills) | Yudhi Armyndharis & Seth Hobson | MIT | Design-time ML engineering & architectural checklist reference |
| [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | AgentLand Contributors | MIT | Design-time role specialist review guidelines |
| [Pythoughts-labs/react-frontend-skills](https://github.com/Pythoughts-labs/react-frontend-skills) | Mohamed Elkholy (PyModel) | MIT | Next.js 16 / React 19 / TanStack Query / Playwright patterns |
| [HuggingFace Transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) | Hugging Face | Apache-2.0 | On-device browser OpenAI Whisper speech transcription worker |
| [public-apis/public-apis](https://github.com/public-apis/public-apis) | public-apis Contributors | MIT | Free API catalog reference (Open-Meteo, RxNorm, openFDA, Nominatim/OpenStreetMap) |
| [ripienaar/free-for-dev](https://github.com/ripienaar/free-for-dev) | R.I. Pienaar & Contributors | Public Repo | Free-tier deployment architecture research |
| [greatfrontend/awesome-front-end-system-design](https://github.com/greatfrontend/awesome-front-end-system-design) | GreatFrontEnd | MIT | RADIO framework for frontend system design documentation |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Frank Fiegel | MIT | MCP server ecosystem catalog |
| Apache ECharts (`echarts`) | Apache Software Foundation | Apache-2.0 | Interactive zoomable clinical time-series charting |
| `ruptures`, `river`, `neurokit2`, `scikit-learn` | Respective scientific Python authors | BSD-2 / BSD-3 / MIT | Statistical change-point detection, streaming anomaly detection, signal quality, robust covariance |

---

## 2. Public Physiological Datasets (Offline Evaluation Only)

| Dataset | Source / Citation | License & Terms | Usage & Restrictions in SENTINEL |
|---|---|---|---|
| **LifeSnaps (Fitbit)** | Yfantidou et al. (*Scientific Data*, 2022) | **CC BY 4.0** | Longitudinal multi-modal Fitbit Sense evaluation (71 participants, ~4 months). Attribution required; commercial/research permitted. |
| **PMData** | Thambawita et al. (*ACM MMSys*, 2020) | **CC BY-NC 4.0** | **Non-commercial offline validation only** (16 participants, ~5 months Fitbit Versa 2). Never ship raw dataset in commercial builds. |
| **WESAD** | Schmidt et al. (*ACM ICMI*, 2018) | **CC BY 4.0 / Academic** | Stress vs baseline wrist Empatica E4 + chest RespiBAN validation for autonomic confounder testing. |
| **MMASH** | Rossi et al. (*Data*, 2020) via PhysioNet | **ODbL v1.0 + PhysioNet DUA** | 24-hour multi-level activity/sleep/IBI validation. Share-alike applies to redistributed database derivatives; no re-identification attempts. |

---

## 3. Public Context Data Providers (No-PHI Outbound Policy)

- **Open-Meteo** (`https://open-meteo.com/`): Weather, heat index, and air quality context (CC BY 4.0 for non-commercial / attribution).
- **U.S. NLM RxNorm API** (`https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html`): Medication terminology normalization (Public Domain / U.S. Government).
- **openFDA** (`https://open.fda.gov/`): Drug labeling reference (CC0 1.0 Public Domain).
- **OpenStreetMap / Nominatim / Overpass** (`https://www.openstreetmap.org/copyright`): Nearest clinic/hospital lookup during emergency escalation (ODbL).
