# HerSpace
A women's empowerment platform for Women all over the world featuring AI career guidance, community workplace reviews, a safe-places map, and a mental health chatbot.

## My Contribution

I conceived HerSpace from the ground up, the idea, the planning, and the full build. This included:
- Defining the core concept and mission
- Planning the feature set and overall structure
- Designing the visual identity, including the color scheme and layout
- Building the core features: AI career guidance (C.A.R.E.), community workplace reviews, the safe-places map, and the mental health chatbot
- Developing the frontend, including navigation, the Leaflet map, and the chat interface

## Quick Start

​```bash
# 1. Install dependencies
npm install

# 2. Add your environment variables
copy .env.example .env
# Open .env and fill in your OpenAI key, database URL, and JWT secret

# 3. Start the server
npm start

# 4. Open in browser
http://localhost:3000
​```

## Project Structure

​```
herspace/
├── server.js           Express server, API routes, and OpenAI proxy
├── db.js               Database connection and queries
├── package.json
├── .env.example         Template, rename to .env
├── .gitignore
├── railway.toml         Deployment config (Railway)
└── public/
    ├── index.html       Landing page
    ├── app.html         Main app (4-screen mobile prototype)
    ├── styles.css       Full design system
    ├── app.js           Navigation, Leaflet map, chat logic
    ├── auth.css         Auth screen styling
    └── auth.js          Sign up / login logic
​```

## Features

| Screen | Description |
|--------|-------------|
| Home | Matched jobs, scholarships, and opportunities powered by C.A.R.E. AI |
| Community |
