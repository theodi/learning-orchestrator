# ODI Forecast and Hubspot Dashboard

## 📘 Overview

The **ODI Forecast and Hubspot Dashboard** is a Node.js + Express web application designed to integrate with the [Forecast](https://www.forecast.app/) project management API. It provides authenticated users with a dashboard to:

- 🔍 View Forecast data (projects, labels)
- 📥 Import new data into Forecast (e.g. create tasks)
- ✅ Validate and manage data via schemas
- 🔐 Authenticate using Google OAuth 2.0
- 📊 Display Forecast data using dynamic DataTables

---

## 🚀 Features

- **Forecast API Integration**
  Interact with Forecast's `/projects`, `/tasks`, `/labels`, and `/persons` endpoints for data viewing and submission.

- **Schema-Driven Import**
  Upload and validate JSON data against defined schemas before importing it into Forecast.

- **Content Negotiation**
  Get data as HTML, JSON, or CSV depending on your `Accept` header.

- **Secure Access**
  Google OAuth 2.0 login ensures only authenticated users can access key routes.

- **Modular Design**
  Route logic separated into clean Express modules for easy maintenance and extensibility.

---

## 🧱 Project Structure

```
project-root/
├── routes/
│   └── forecast.js          # Forecast routes (view + import)
├── schemas/                 # JSON schema definitions
├── views/
│   ├── pages/
│   │   ├── forecast/        # Pages for forecast views
│   │   ├── profile.ejs
│   ├── errors/
│       ├── 401.ejs
│       ├── 404.ejs
├── public/                  # Static assets (JS/CSS)
├── private/                 # Auth-protected files
├── config.env               # Environment variables
├── index.js                 # Main app entry point
├── package.json
```

---

## ⚙️ Installation

### 1. Clone the repository
```bash
git clone https://github.com/theodi/odi-forecast-helper.git
cd odi-forecast-helper
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables

Copy `config.env.example` to config.env and edit the config variables

> ⚠️ Never commit `.env` files to version control.

### 4. Add your schemas

Place any JSON schema files in the `/schemas` directory. These are used to validate data before import.

---

## 🧪 Running the App

```bash
npm start
# or if not defined in package.json:
node index.js
```

Visit: [http://localhost:3080](http://localhost:3080)

You’ll be redirected to sign in with Google before accessing protected routes.

---

## 📫 Routes

| Route                         | Method | Auth | Description                                |
|------------------------------|--------|------|--------------------------------------------|
| `/forecast/:type`            | GET    | ✅   | View Forecast data for a type (JSON/CSV/UI)|
| `/forecast/import?type=task` | POST   | ✅   | Import new task/project/etc to Forecast    |
| `/forecast/schemas`          | GET    | ❌   | List available JSON schemas                |
| `/forecast/schemas/:type`    | GET    | ❌   | Get a specific schema                      |

---

## ✅ To Do

- [ ] Add better error handling and logging
- [ ] Add unit and integration tests

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first to discuss what you’d like to change.

---

## 📄 License

MIT – feel free to use, remix, and share.

```