# HerSpace
A women's empowerment platform for Pakistan and South Asia — featuring AI career guidance, community workplace reviews, a safe-places map, and a mental health chatbot.

## My Contribution

I conceived HerSpace from the ground up, the idea, the planning, 
and the full build. This included:
- Defining the core concept and mission
- Planning the feature set and overall structure
- Designing the visual identity, including the color scheme and layout
- Building the core features: AI career guidance (C.A.R.E.), 
  community workplace reviews, the safe-places map, and the mental 
  health chatbot
- Developing the frontend, including navigation, the Leaflet map, 
  and the chat interface

## Quick Start
\`\`\`bash
# 1. Install dependencies
npm install
# 2. Add your OpenAI key
copy .env.example .env
# Open .env and replace sk-replace-me with your real key
# 3. Start the server
node server.js
# 4. Open in browser
http://localhost:3000
\`\`\`

## Project Structure
\`\`\`
herspace/
├── server.js           Express proxy for OpenAI Chat Completions
├── package.json
├── .env.example        Template — rename to .env
├── .gitignore
└── public/
    ├── index.html      4-screen mobile prototype
    ├── styles.css      Full design system
    └── app.js          Navigation, Leaflet map, chat logic
\`\`\`

## Features
| Screen | Description |
|--------|-------------|
| **Home** | Matched jobs, scholarships, and opportunities powered by C.A.R.E. AI |
| **Community** | Workplace reviews rated by women |
| **Safe Map** | Leaflet dark map with safe/flagged location pins across Lahore |
| **ChatBot** | Live GPT-4o-mini chat across Career, Health, and Wellbeing tabs |

## Notes
- The OpenAI API key **never** reaches the browser — all requests proxy through `/api/chat`.
- Node 18+ is required (uses native `fetch`).
- The map uses CartoDB Dark Matter tiles and Leaflet 1.9.4 (loaded via CDN).

---
*Note: This repository is a fork of the original team project.*
