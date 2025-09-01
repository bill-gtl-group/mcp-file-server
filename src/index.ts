#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration interface
interface FileServerConfig {
  folders: {
    [key: string]: string;
  };
  allowedExtensions?: string[];
  maxFileSize?: number; // in bytes
}

// Default configuration - can be overridden by environment variables
const DEFAULT_CONFIG: FileServerConfig = {
  folders: {
    "documents": process.env.DOCUMENTS_FOLDER || "C:\\Users\\bill\\Documents",
    "reports": process.env.REPORTS_FOLDER || "C:\\Support",
    "desktop": process.env.DESKTOP_FOLDER || "C:\\Users\\bill\\Desktop"
  },
  allowedExtensions: ['.txt', '.md', '.pdf', '.docx', '.xlsx', '.csv', '.json', '.xml', '.log'],
  maxFileSize: 10 * 1024 * 1024 // 10MB
};

class FileServer {
  private server: Server;
  private config: FileServerConfig;

  constructor() {
    // Load configuration from environment variables or use defaults
    this.config = this.loadConfig();
    
    this.server = new Server(
      {
        name: 'file-server-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupResourceHandlers();
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private loadConfig(): FileServerConfig {
    try {
      // Try to load config from environment variable
      const configJson = process.env.FILE_SERVER_CONFIG;
      if (configJson) {
        const envConfig = JSON.parse(configJson);
        return { ...DEFAULT_CONFIG, ...envConfig };
      }
    } catch (error) {
      console.error('Error parsing FILE_SERVER_CONFIG:', error);
    }
    
    return DEFAULT_CONFIG;
  }

  private isAllowedFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return this.config.allowedExtensions?.includes(ext) || false;
  }

  private getFileStats(filePath: string): { size: number; modified: Date } | null {
    try {
      const stats = fs.statSync(filePath);
      return {
        size: stats.size,
        modified: stats.mtime
      };
    } catch {
      return null;
    }
  }

  private setupResourceHandlers() {
    // List available resources (folders and their files)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources: any[] = [];
      
      for (const [folderName, folderPath] of Object.entries(this.config.folders)) {
        try {
          if (fs.existsSync(folderPath)) {
            // Add folder as a resource
            resources.push({
              uri: `file://${folderName}`,
              name: `Files in ${folderName} folder`,
              mimeType: 'application/json',
              description: `List of files in ${folderPath}`
            });
            
            // Add individual files as resources
            const files = fs.readdirSync(folderPath);
            for (const file of files) {
              const filePath = path.join(folderPath, file);
              const stats = fs.statSync(filePath);
              
              if (stats.isFile() && this.isAllowedFile(filePath)) {
                resources.push({
                  uri: `file://${folderName}/${file}`,
                  name: `${file} (${folderName})`,
                  mimeType: this.getMimeType(file),
                  description: `File: ${file} in ${folderName} folder (${stats.size} bytes)`
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error accessing folder ${folderName}:`, error);
        }
      }
      
      return { resources };
    });

    // Resource templates for dynamic file access
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: [
        {
          uriTemplate: 'file://{folder}',
          name: 'Folder contents',
          mimeType: 'application/json',
          description: 'List files in a configured folder'
        },
        {
          uriTemplate: 'file://{folder}/{filename}',
          name: 'File content',
          mimeType: 'text/plain',
          description: 'Read content of a specific file'
        }
      ]
    }));

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      // Parse URI: file://folder or file://folder/filename
      const match = uri.match(/^file:\/\/([^\/]+)(?:\/(.+))?$/);
      if (!match) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid URI format: ${uri}`);
      }
      
      const [, folderName, filename] = match;
      
      if (!this.config.folders[folderName]) {
        throw new McpError(ErrorCode.InvalidRequest, `Unknown folder: ${folderName}`);
      }
      
      const folderPath = this.config.folders[folderName];
      
      if (!filename) {
        // Return folder contents
        try {
          const files = fs.readdirSync(folderPath);
          const fileList = files
            .map(file => {
              const filePath = path.join(folderPath, file);
              const stats = this.getFileStats(filePath);
              return {
                name: file,
                path: filePath,
                size: stats?.size || 0,
                modified: stats?.modified || new Date(),
                isAllowed: this.isAllowedFile(filePath)
              };
            })
            .filter(f => f.isAllowed);
          
          return {
            contents: [{
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(fileList, null, 2)
            }]
          };
        } catch (error) {
          throw new McpError(ErrorCode.InternalError, `Error reading folder: ${error}`);
        }
      } else {
        // Return file content
        const filePath = path.join(folderPath, filename);
        
        if (!this.isAllowedFile(filePath)) {
          throw new McpError(ErrorCode.InvalidRequest, `File type not allowed: ${filename}`);
        }
        
        try {
          const stats = fs.statSync(filePath);
          
          if (stats.size > (this.config.maxFileSize || Infinity)) {
            throw new McpError(ErrorCode.InvalidRequest, `File too large: ${stats.size} bytes`);
          }
          
          const content = fs.readFileSync(filePath, 'utf8');
          
          return {
            contents: [{
              uri: request.params.uri,
              mimeType: this.getMimeType(filename),
              text: content
            }]
          };
        } catch (error) {
          throw new McpError(ErrorCode.InternalError, `Error reading file: ${error}`);
        }
      }
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_files',
          description: 'List files in a configured folder',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: `Folder name to list files from. Available: ${Object.keys(this.config.folders).join(', ')}`,
                enum: Object.keys(this.config.folders)
              },
              pattern: {
                type: 'string',
                description: 'Optional file pattern to match (e.g., "*.txt")'
              }
            },
            required: ['folder']
          }
        },
        {
          name: 'read_file',
          description: 'Read the content of a specific file',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: `Folder name containing the file. Available: ${Object.keys(this.config.folders).join(', ')}`,
                enum: Object.keys(this.config.folders)
              },
              filename: {
                type: 'string',
                description: 'Name of the file to read'
              }
            },
            required: ['folder', 'filename']
          }
        },
        {
          name: 'search_files',
          description: 'Search for files containing specific text',
          inputSchema: {
            type: 'object',
            properties: {
              folder: {
                type: 'string',
                description: `Folder name to search in. Available: ${Object.keys(this.config.folders).join(', ')}`,
                enum: Object.keys(this.config.folders)
              },
              searchText: {
                type: 'string',
                description: 'Text to search for in file contents'
              },
              caseSensitive: {
                type: 'boolean',
                description: 'Whether search should be case sensitive',
                default: false
              }
            },
            required: ['folder', 'searchText']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'list_files':
          return this.handleListFiles(args);
        case 'read_file':
          return this.handleReadFile(args);
        case 'search_files':
          return this.handleSearchFiles(args);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }

  private async handleListFiles(args: any) {
    const { folder, pattern } = args;
    
    if (!this.config.folders[folder]) {
      return {
        content: [{ type: 'text', text: `Error: Unknown folder '${folder}'` }],
        isError: true
      };
    }
    
    try {
      const folderPath = this.config.folders[folder];
      const files = fs.readdirSync(folderPath);
      
      let filteredFiles = files.filter(file => {
        const filePath = path.join(folderPath, file);
        return fs.statSync(filePath).isFile() && this.isAllowedFile(filePath);
      });
      
      if (pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
        filteredFiles = filteredFiles.filter(file => regex.test(file));
      }
      
      const fileDetails = filteredFiles.map(file => {
        const filePath = path.join(folderPath, file);
        const stats = this.getFileStats(filePath);
        return {
          name: file,
          size: stats?.size || 0,
          modified: stats?.modified?.toISOString() || '',
          extension: path.extname(file)
        };
      });
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            folder: folder,
            path: folderPath,
            fileCount: fileDetails.length,
            files: fileDetails
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error listing files: ${error}` }],
        isError: true
      };
    }
  }

  private async handleReadFile(args: any) {
    const { folder, filename } = args;
    
    if (!this.config.folders[folder]) {
      return {
        content: [{ type: 'text', text: `Error: Unknown folder '${folder}'` }],
        isError: true
      };
    }
    
    try {
      const folderPath = this.config.folders[folder];
      const filePath = path.join(folderPath, filename);
      
      if (!this.isAllowedFile(filePath)) {
        return {
          content: [{ type: 'text', text: `Error: File type not allowed: ${filename}` }],
          isError: true
        };
      }
      
      const stats = fs.statSync(filePath);
      if (stats.size > (this.config.maxFileSize || Infinity)) {
        return {
          content: [{ type: 'text', text: `Error: File too large: ${stats.size} bytes` }],
          isError: true
        };
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      
      return {
        content: [{
          type: 'text',
          text: `File: ${filename}\nPath: ${filePath}\nSize: ${stats.size} bytes\n\n--- Content ---\n${content}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error reading file: ${error}` }],
        isError: true
      };
    }
  }

  private async handleSearchFiles(args: any) {
    const { folder, searchText, caseSensitive = false } = args;
    
    if (!this.config.folders[folder]) {
      return {
        content: [{ type: 'text', text: `Error: Unknown folder '${folder}'` }],
        isError: true
      };
    }
    
    try {
      const folderPath = this.config.folders[folder];
      const files = fs.readdirSync(folderPath);
      const results: any[] = [];
      
      for (const file of files) {
        const filePath = path.join(folderPath, file);
        
        if (fs.statSync(filePath).isFile() && this.isAllowedFile(filePath)) {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const searchIn = caseSensitive ? content : content.toLowerCase();
            const searchFor = caseSensitive ? searchText : searchText.toLowerCase();
            
            if (searchIn.includes(searchFor)) {
              // Find line numbers with matches
              const lines = content.split('\n');
              const matchingLines: { line: number; text: string }[] = [];
              
              lines.forEach((line, index) => {
                const lineToSearch = caseSensitive ? line : line.toLowerCase();
                if (lineToSearch.includes(searchFor)) {
                  matchingLines.push({
                    line: index + 1,
                    text: line.trim()
                  });
                }
              });
              
              results.push({
                file: file,
                path: filePath,
                matches: matchingLines.length,
                matchingLines: matchingLines.slice(0, 10) // Limit to first 10 matches
              });
            }
          } catch (error) {
            // Skip files that can't be read as text
          }
        }
      }
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            searchText: searchText,
            caseSensitive: caseSensitive,
            folder: folder,
            totalFiles: results.length,
            results: results
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error searching files: ${error}` }],
        isError: true
      };
    }
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.csv': 'text/csv',
      '.log': 'text/plain',
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    
    return mimeTypes[ext] || 'text/plain';
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('File Server MCP running on stdio');
    console.error('Configured folders:', Object.keys(this.config.folders));
  }
}

const server = new FileServer();
server.run().catch(console.error);
