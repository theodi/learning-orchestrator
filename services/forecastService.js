import axios from "axios";
import { getForecastApiUrl } from '../config/constants.js';
import Task from '../models/Task.js';

export class ForecastService {
  constructor() {
    this.apiKey = process.env.FORECAST_API_KEY;
    this.headers = {
      "X-FORECAST-API-KEY": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  /**
   * Get the API URL for a specific type
   */
  getApiUrl(type) {
    return getForecastApiUrl(type);
  }

  /**
   * Fetch Forecast users (tutors)
   */
  async fetchUsers() {
    try {
      const apiUrl = this.getApiUrl('persons');
      const response = await axios.get(`${apiUrl}/persons`, { headers: this.headers });

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
   * Look up person IDs by email addresses
   */
  async lookupPersonIdsByEmails(emails) {
    try {
      const users = await this.fetchUsers();
      const emailToIdMap = {};
      const notFoundEmails = [];

      // Create a map of email to person ID
      users.forEach(user => {
        if (user.email) {
          emailToIdMap[user.email.toLowerCase()] = user.id;
        }
      });

      // Look up each email
      const personIds = [];
      emails.forEach(email => {
        const cleanEmail = email.trim().toLowerCase();
        if (emailToIdMap[cleanEmail]) {
          personIds.push(emailToIdMap[cleanEmail]);
        } else {
          notFoundEmails.push(email);
        }
      });

      return {
        personIds,
        notFoundEmails,
        allFound: notFoundEmails.length === 0
      };
    } catch (error) {
      console.error("Error looking up person IDs:", error);
      throw error;
    }
  }

  /**
   * Fetch Forecast projects
   */
  async fetchProjects() {
    try {
      const apiUrl = this.getApiUrl('projects');
      const response = await axios.get(`${apiUrl}/projects`, { headers: this.headers });

      return response.data.map((project) => ({
        id: project.id,
        company_project_id: project.custom_project_id || project.company_project_id || project.id, // Use company_project_id if available, fallback to id
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
   * Create a project in Forecast
   */
  async createProject(projectData) {
    const apiUrl = this.getApiUrl('projects');

    try {
      const response = await axios.post(`${apiUrl}/projects`, projectData, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("Error creating project in Forecast:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch Forecast tasks
   */
  async fetchTasks() {
    try {
      const apiUrl = this.getApiUrl('tasks');
      const response = await axios.get(`${apiUrl}/tasks`, { headers: this.headers });

      return response.data.map((task) => Task.fromForecastData(task));
    } catch (error) {
      console.error("Error fetching tasks:", error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get data by type
   */
  async getDataByType(type) {
    const apiUrl = this.getApiUrl(type);

    try {
      const response = await axios.get(`${apiUrl}/${type}`, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error(`Error fetching Forecast ${type}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Import data into Forecast
   */
  async importData(type, data) {
    const apiUrl = this.getApiUrl(type);

    try {
      const response = await axios.post(`${apiUrl}/${type}s`, data, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("Error importing data into Forecast:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Create a task in Forecast
   */
  async createTask(taskData) {
    const apiUrl = this.getApiUrl('tasks');

    try {
      const response = await axios.post(`${apiUrl}/tasks`, taskData, { headers: this.headers });
      return response.data;
    } catch (error) {
      console.error("Error creating task in Forecast:", error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Get task by ID
   */
  async getTaskById(id) {
    const apiUrl = this.getApiUrl('tasks');

    try {
      const response = await axios.get(`${apiUrl}/tasks/${id}`, { headers: this.headers });
      return Task.fromForecastData(response.data);
    } catch (error) {
      console.error(`Error fetching task ${id}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Update task
   */
  async updateTask(id, taskData) {
    const apiUrl = this.getApiUrl('tasks');

    try {
      const response = await axios.put(`${apiUrl}/tasks/${id}`, taskData, { headers: this.headers });
      return Task.fromForecastData(response.data);
    } catch (error) {
      console.error(`Error updating task ${id}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Delete task
   */
  async deleteTask(id) {
    const apiUrl = this.getApiUrl('tasks');

    try {
      await axios.delete(`${apiUrl}/tasks/${id}`, { headers: this.headers });
      return true;
    } catch (error) {
      console.error(`Error deleting task ${id}:`, error.response?.data || error.message);
      throw error;
    }
  }
}

// Export individual functions for backward compatibility
export const fetchForecastUsers = async () => {
  const service = new ForecastService();
  return service.fetchUsers();
};

export const fetchForecastProjects = async () => {
  const service = new ForecastService();
  return service.fetchProjects();
};

export const fetchForecastTasks = async () => {
  const service = new ForecastService();
  return service.fetchTasks();
};

export default ForecastService;

