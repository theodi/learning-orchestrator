const axios = require("axios");

const FORECAST_API_KEY = process.env.FORECAST_API_KEY;
const BASE_URL_V2 = "https://api.forecast.it/api/v2";
const BASE_URL_V3 = "https://api.forecast.it/api/v3";

const headers = {
  "X-FORECAST-API-KEY": FORECAST_API_KEY,
  "Content-Type": "application/json",
};

/**
 * Fetch Forecast users (tutors)
 */
async function fetchForecastUsers() {
  try {
    const response = await axios.get(`${BASE_URL_V2}/persons`, { headers });

    return response.data.map((user) => ({
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
    }));
  } catch (error) {
    console.error("Error fetching users:", error.response?.data || error.message);
    return [];
  }
}

/**
 * Fetch Forecast projects
 */
async function fetchForecastProjects() {
  try {
    const response = await axios.get(`${BASE_URL_V3}/projects`, { headers });

    return response.data.map((project) => ({
      id: project.id,
      name: project.name,
      client: project.client_name || '',
      status: project.status,
    }));
  } catch (error) {
    console.error("Error fetching projects:", error.response?.data || error.message);
    return [];
  }
}

/**
 * Fetch Forecast tasks
 */
async function fetchForecastTasks() {
  try {
    const response = await axios.get(`${BASE_URL_V3}/tasks`, { headers });

    return response.data.map((task) => ({
      id: task.id,
      title: task.title,
      project_id: task.project_id,
      assignee_id: task.person_id,
      status: task.status,
    }));
  } catch (error) {
    console.error("Error fetching tasks:", error.response?.data || error.message);
    return [];
  }
}

module.exports = {
  fetchForecastUsers,
  fetchForecastProjects,
  fetchForecastTasks,
};

