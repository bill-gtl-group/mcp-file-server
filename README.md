# File Server MCP

A Model Context Protocol (MCP) server that exposes documents from specific folders through configurable access.

## Features

- **Configurable Folders**: Expose specific folders like Documents, Reports, Desktop, etc.
- **File Type Filtering**: Only allow specific file extensions for security
- **Size Limits**: Configurable maximum file size limits
- **Tools Available**:
  - `list_files`: List files in a configured folder with optional pattern matching
  - `read_file`: Read the content of a specific file
  - `search_files`: Search for files containing specific text
- **Resources**: Access files through MCP resource URIs like `file://documents/filename.txt`

## Configuration

The server can be configured through environment variables or the `config.json` file:

### Default Folders
- `documents`: C:\Users\bill\Documents
- `reports`: C:\Support  
- `desktop`: C:\Users\bill\Desktop
- `backup_scripts`: C:\support

### Environment Variables
- `FILE_SERVER_CONFIG`: JSON string with custom configuration
- `DOCUMENTS_FOLDER`: Override documents folder path
- `REPORTS_FOLDER`: Override reports folder path
- `DESKTOP_FOLDER`: Override desktop folder path

### Configuration File
Edit `config.json` to customize:
```json
{
  "folders": {
    "documents": "C:\\Users\\bill\\Documents",
    "reports": "C:\\Support",
    "desktop": "C:\\Users\\bill\\Desktop",
    "backup_scripts": "C:\\support"
  },
  "allowedExtensions": [".txt", ".md", ".pdf", ".docx", ".xlsx", ".csv", ".json", ".xml", ".log", ".ps1"],
  "maxFileSize": 10485760
}
```

## Installation

### Prerequisites
1. Install Node.js (https://nodejs.org/)
2. Install npm dependencies:
   ```bash
   npm install
   ```

### Build
```bash
npm run build
```

### MCP Configuration

Add to your MCP settings file (`C:\Users\bill\AppData\Roaming\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "file-server": {
      "command": "node",
      "args": ["C:/Users/bill/Desktop/file-server/build/index.js"],
      "env": {
        "FILE_SERVER_CONFIG": "{\"folders\":{\"documents\":\"C:\\\\Users\\\\bill\\\\Documents\",\"reports\":\"C:\\\\Support\",\"desktop\":\"C:\\\\Users\\\\bill\\\\Desktop\",\"backup_scripts\":\"C:\\\\support\"}}"
      }
    }
  }
}
```

## Usage Examples

Once installed, you can use the file server through MCP tools:

### List Files
```
Use the list_files tool with folder="documents" to see all files in the Documents folder
```

### Read a File
```
Use the read_file tool with folder="reports" and filename="backup-report.csv" to read a specific file
```

### Search Files
```
Use the search_files tool with folder="backup_scripts" and searchText="SQLite" to find scripts containing "SQLite"
```

### Access Resources
```
Access file://documents/ to get a list of files in Documents
Access file://reports/backup-report.csv to read a specific file
```

## Security Features

- Only configured folders are accessible
- File type restrictions through allowedExtensions
- File size limits to prevent large file access
- Path traversal protection
- Read-only access (no file modification)

## Folder Structure

```
file-server/
├── package.json          # Node.js package configuration
├── tsconfig.json         # TypeScript configuration  
├── config.json          # Server configuration
├── README.md            # This file
├── src/
│   └── index.ts         # Main server implementation
└── build/               # Compiled JavaScript (after npm run build)
    └── index.js         # Executable MCP server
```

## Development

```bash
# Watch mode for development
npm run dev

# Build for production
npm run build

# Test the server
npm start
