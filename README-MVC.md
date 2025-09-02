# ODI Forecast Import - MVC Architecture

This application has been refactored to follow a clean Model-View-Controller (MVC) architecture pattern for better maintainability, testability, and separation of concerns.

## Architecture Overview

```
odi-forecast-import/
├── config/                 # Configuration files
│   ├── constants.js        # Application constants and API version mapping
│   └── database.js         # Database configuration
├── controllers/            # Controller layer (handles HTTP requests/responses)
│   ├── BaseController.js   # Base controller with common functionality
│   ├── AuthController.js   # Authentication operations
│   ├── ForecastController.js # Forecast API operations
│   └── HubSpotController.js # HubSpot API operations
├── models/                 # Model layer (data models and business logic)
│   ├── User.js            # User model
│   └── Task.js            # Task model
├── services/              # Service layer (business logic and external APIs)
│   ├── forecastService.js # Forecast API service
│   └── hubspotService.js  # HubSpot API service
├── routes/                # Route definitions (thin layer)
│   ├── auth.js           # Authentication routes
│   ├── forecast.js       # Forecast routes
│   └── hubspot.js        # HubSpot routes
├── utils/                 # Utility functions
│   ├── response.js       # Standardized API responses
│   └── validation.js     # Validation utilities
├── middleware/           # Express middleware
├── views/               # EJS templates (View layer)
├── public/              # Static assets
└── schemas/             # JSON schemas for validation
```

## Key Components

### 1. Models (`/models`)
- **User.js**: Represents user data and operations
- **Task.js**: Represents task data and operations
- Models handle data validation, transformation, and business rules

### 2. Controllers (`/controllers`)
- **BaseController.js**: Provides common CRUD operations and helper methods
- **AuthController.js**: Handles authentication-related operations
- **ForecastController.js**: Manages Forecast API interactions
- **HubSpotController.js**: Manages HubSpot API interactions
- Controllers handle HTTP requests, validation, and responses

### 3. Services (`/services`)
- **ForecastService.js**: Encapsulates all Forecast API logic with dynamic version mapping
- **HubSpotService.js**: Encapsulates all HubSpot API logic
- Services contain business logic and external API interactions

### 4. Routes (`/routes`)
- Thin layer that maps HTTP endpoints to controller methods
- Routes are now much cleaner and focused only on routing

### 5. Utils (`/utils`)
- **response.js**: Standardized API response formatting
- **validation.js**: Common validation functions
- Reusable utility functions

### 6. Config (`/config`)
- **constants.js**: Application constants, API endpoints, and version mapping
- **database.js**: Database configuration (for future use)

## Forecast API Configuration

The Forecast API now uses a centralized configuration with dynamic version mapping:

```javascript
// config/constants.js
export const API_ENDPOINTS = {
  FORECAST: {
    BASE_URL: "https://api.forecast.it/api",
    VERSION_MAP: {
      labels: "v1",
      projects: "v3", 
      tasks: "v3",
      persons: "v2"
    }
  }
};

// Helper function to get the correct API URL
export const getForecastApiUrl = (type) => {
  const version = API_ENDPOINTS.FORECAST.VERSION_MAP[type];
  return `${API_ENDPOINTS.FORECAST.BASE_URL}/${version}`;
};
```

This approach provides:
- **Single source of truth** for the base URL
- **Dynamic version mapping** based on API type
- **Easy maintenance** when API versions change
- **Type safety** with validation for invalid types

## Benefits of the New Architecture

### 1. **Separation of Concerns**
- Controllers handle HTTP logic
- Services handle business logic
- Models handle data logic
- Routes handle routing only

### 2. **Testability**
- Each layer can be tested independently
- Services can be easily mocked
- Controllers can be unit tested

### 3. **Maintainability**
- Clear responsibility boundaries
- Easier to locate and fix issues
- Consistent patterns across the application

### 4. **Reusability**
- Services can be reused across different controllers
- Utility functions are centralized
- Models can be used in different contexts

### 5. **Scalability**
- Easy to add new features
- Clear structure for new developers
- Consistent API responses

## Usage Examples

### Creating a New Controller
```javascript
import BaseController from './BaseController.js';
import MyService from '../services/myService.js';

export class MyController extends BaseController {
  constructor() {
    super();
    this.service = new MyService();
  }

  async myMethod(req, res) {
    try {
      const data = await this.service.doSomething(req.body);
      return this.sendSuccess(res, data);
    } catch (error) {
      return this.sendError(res, error.message);
    }
  }
}
```

### Creating a New Service
```javascript
import axios from 'axios';
import { getForecastApiUrl } from '../config/constants.js';

export class MyService {
  constructor() {
    this.apiKey = process.env.MY_API_KEY;
  }

  async doSomething(type, data) {
    const apiUrl = getForecastApiUrl(type);
    const response = await axios.post(`${apiUrl}/endpoint`, data, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    return response.data;
  }
}
```

### Creating a New Route
```javascript
import express from 'express';
import { ensureAuthenticated } from '../middleware/auth.js';
import MyController from '../controllers/MyController.js';

const router = express.Router();
const myController = new MyController();

router.get('/', ensureAuthenticated, (req, res) => myController.myMethod(req, res));

export default router;
```

## Migration Notes

The application has been migrated from a monolithic structure to a clean MVC architecture:

1. **ES Modules**: All files now use ES modules (`import`/`export`)
2. **Class-based Services**: Services are now proper classes with better organization
3. **Controller Pattern**: HTTP logic is now separated into controllers
4. **Standardized Responses**: All API responses follow a consistent format
5. **Centralized Configuration**: Constants and configuration are centralized
6. **Better Error Handling**: Consistent error handling across the application
7. **Dynamic API Versioning**: Forecast API uses centralized version mapping

## Testing

The application includes a comprehensive test suite located in the `tests/` directory.

### Running Tests

```bash
# Run all tests
npm run test:run

# Run specific tests
npm run test:config      # Test configuration and version mapping
npm run test:projects    # Test project dropdown functionality
npm run test:email-lookup # Test email-to-person-ID lookup
npm run test:restful-api # Test RESTful API endpoints
npm run test:task-linking # Test task linking functionality

# Run individual test files
node tests/test-config.js
node tests/test-project-dropdown.js
node tests/test-email-lookup.js
node tests/test-restful-api.js
node tests/test-task-linking.js
```

### Test Structure

```
tests/
├── README.md              # Test documentation
├── run-tests.js           # Test runner script
├── test-config.js         # Configuration tests
└── test-project-dropdown.js # Project dropdown tests
```

### Test Requirements

- Valid `FORECAST_API_KEY` environment variable (for API tests)
- Internet connection to access Forecast API
- Node.js with ES modules support

## Next Steps

1. **Testing**: Add unit tests for controllers, services, and models
2. **Documentation**: Add JSDoc comments to all methods
3. **Validation**: Implement more robust validation using the validation utilities
4. **Logging**: Add structured logging throughout the application
5. **Database**: Integrate a proper database when needed

## Key Features

### 1. **Forecast API Integration**
- **Dynamic Version Mapping**: Centralized configuration for different API versions
- **Project Dropdown**: When importing tasks, users can select from available projects instead of including project_id in CSV
- **Email-to-Person-ID Lookup**: Convert email addresses to person IDs for assigned_persons field
- **Schema Validation**: JSON schema validation for imported data
- **Real-time Import Status**: Live feedback during import process
- **Task Linking**: Automatic creation of direct links to imported tasks in Forecast

### 2. **HubSpot Integration**
- **Contact Management**: Create and manage HubSpot contacts
- **Company Search**: Search and link companies to contacts
- **Webhook Handling**: Process form submissions from HubSpot
- **Deal Management**: Link deals to products and track progress

### 3. **Authentication**
- **Google OAuth**: Secure authentication via Google
- **Session Management**: Persistent user sessions
- **Protected Routes**: Authentication middleware for sensitive operations

## Email-to-Person-ID Lookup

The application now supports converting email addresses to person IDs for the `assigned_persons` field when importing tasks.

### How It Works

1. **CSV Format**: Users can include email addresses in the `assigned_persons` column:
   ```csv
   title,description,assigned_persons
   Task 1,Description,"davetaz@theodi.org"
   Task 2,Description,"davetaz@theodi.org,invalid@theodi.org"
   ```

2. **Automatic Conversion**: During validation, the system:
   - Fetches all users from Forecast API
   - Creates a mapping of email addresses to person IDs
   - Converts valid emails to person IDs
   - Reports invalid emails that couldn't be found

3. **Visual Feedback**: The import preview shows:
   - **Found IDs**: Successfully converted person IDs
   - **Not Found**: Email addresses that couldn't be resolved (in red)

4. **Import Process**: Only valid person IDs are sent to the Forecast API

### Task Linking

When tasks are successfully imported, the application automatically creates direct links to the tasks in Forecast:

1. **URL Format**: Uses the correct Forecast URL structure: `https://app.forecast.it/project/P{company_project_id}/task-board/T{company_task_id}`

2. **Automatic Linking**: After successful import, the "SUCCESS" status becomes a clickable link that opens the task directly in Forecast

3. **Project Context**: Links include the project context, taking users directly to the task within the correct project

4. **External Opening**: Links open in new tabs/windows to preserve the import session

### RESTful API Endpoints

The application provides RESTful endpoints for person management:

```bash
# Get all persons
GET /forecast/persons

# Get person(s) by email
GET /forecast/persons?email=davetaz@theodi.org
GET /forecast/persons?email=davetaz@theodi.org&email=invalid@theodi.org

# Get person by ID
GET /forecast/persons/123
```

### RESTful Task Endpoints

The application provides full CRUD operations for tasks:

```bash
# Get all tasks
GET /forecast/tasks

# Create a new task
POST /forecast/tasks

# Get task by ID
GET /forecast/tasks/123

# Update task
PUT /forecast/tasks/123

# Delete task
DELETE /forecast/tasks/123
```

### Benefits

- **User-Friendly**: No need to know person IDs
- **Error Prevention**: Clear feedback on invalid emails
- **Flexible**: Supports single or multiple email addresses
- **Robust**: Handles missing or invalid emails gracefully
- **RESTful**: Follows REST API conventions
- **CRUD Operations**: Full CRUD support for persons
