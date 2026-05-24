const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const logger = require('../utils/logger');

class CodeService {
  constructor() {
    this.projectPath = null;
  }

  setProjectPath(projectPath) {
    this.projectPath = projectPath;
  }

  getProjectPath() {
    return this.projectPath;
  }

  /**
   * Read a file from the project
   */
  readFile(filePath) {
    try {
      const resolvedPath = this.resolvePath(filePath);
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const stats = fs.statSync(resolvedPath);

      return {
        success: true,
        path: resolvedPath,
        relativePath: this.projectPath ? path.relative(this.projectPath, resolvedPath) : resolvedPath,
        content,
        size: stats.size,
        modifiedAt: stats.mtime,
        extension: path.extname(resolvedPath),
        lineCount: content.split('\n').length,
      };
    } catch (error) {
      logger.error('CodeService readFile error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Write/edit a file in the project
   */
  writeFile(filePath, content, options = {}) {
    try {
      const resolvedPath = this.resolvePath(filePath, options.createDir !== false);

      // Create directory structure if it doesn't exist
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, content, 'utf-8');

      logger.info(`CodeService: Written file ${resolvedPath}`);

      return {
        success: true,
        path: resolvedPath,
        relativePath: this.projectPath ? path.relative(this.projectPath, resolvedPath) : resolvedPath,
        size: Buffer.byteLength(content, 'utf-8'),
        message: `File saved: ${path.basename(resolvedPath)}`,
      };
    } catch (error) {
      logger.error('CodeService writeFile error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create the default starter file (example/first.py with todo list)
   */
  createStarterFile() {
    if (!this.projectPath) {
      return { success: false, error: 'No project path selected' };
    }

    const filePath = path.join('example', 'first.py');
    const content = `# Simple To-Do List Application
# Created by API Debugging Copilot

todo_list = []

def show_menu():
    """Display the menu options to the user."""
    print("\\n" + "=" * 40)
    print("      MY TO-DO LIST MANAGER")
    print("=" * 40)
    print("1. View all tasks")
    print("2. Add a new task")
    print("3. Mark task as completed")
    print("4. Delete a task")
    print("5. Exit")
    print("=" * 40)

def view_tasks():
    """Display all tasks with their status."""
    if not todo_list:
        print("\\n📋 No tasks yet! Add one using option 2.")
        return

    print("\\n📋 YOUR TASKS:")
    print("-" * 40)
    for i, task in enumerate(todo_list, 1):
        status = "✅" if task["completed"] else "⬜"
        print(f"{i}. {status} {task['title']}")
        if task["description"]:
            print(f"   📝 {task['description']}")
    print("-" * 40)

def add_task():
    """Add a new task to the list."""
    title = input("\\nEnter task title: ").strip()
    if not title:
        print("❌ Task title cannot be empty!")
        return

    description = input("Enter description (optional): ").strip()

    task = {
        "title": title,
        "description": description,
        "completed": False
    }
    todo_list.append(task)
    print(f"✅ Task '{title}' added successfully!")

def complete_task():
    """Mark a task as completed."""
    view_tasks()
    if not todo_list:
        return

    try:
        choice = int(input("\\nEnter task number to mark as completed: "))
        if 1 <= choice <= len(todo_list):
            todo_list[choice - 1]["completed"] = True
            print(f"✅ Task {choice} marked as completed! 🎉")
        else:
            print("❌ Invalid task number!")
    except ValueError:
        print("❌ Please enter a valid number!")

def delete_task():
    """Delete a task from the list."""
    view_tasks()
    if not todo_list:
        return

    try:
        choice = int(input("\\nEnter task number to delete: "))
        if 1 <= choice <= len(todo_list):
            removed = todo_list.pop(choice - 1)
            print(f"🗑️ Task '{removed['title']}' deleted!")
        else:
            print("❌ Invalid task number!")
    except ValueError:
        print("❌ Please enter a valid number!")

def main():
    """Main program loop."""
    print("\\n🌟 Welcome to the To-Do List App! 🌟")
    print("Manage your tasks efficiently.")

    while True:
        show_menu()
        try:
            choice = input("\\nEnter your choice (1-5): ").strip()

            if choice == "1":
                view_tasks()
            elif choice == "2":
                add_task()
            elif choice == "3":
                complete_task()
            elif choice == "4":
                delete_task()
            elif choice == "5":
                print("\\n👋 Thank you for using the To-Do List App!")
                print("Goodbye!\\n")
                break
            else:
                print("❌ Invalid choice! Please enter 1-5.")

        except KeyboardInterrupt:
            print("\\n\\n👋 Exiting... Goodbye!")
            break

if __name__ == "__main__":
    main()
`;

    return this.writeFile(filePath, content, { createDir: true });
  }

  /**
   * Open a file or folder in VSCode
   */
  openInVSCode(targetPath = null) {
    return new Promise((resolve) => {
      let resolvedTarget;
      try {
        resolvedTarget = targetPath
          ? this.resolvePath(targetPath)
          : this.projectPath;
      } catch (err) {
        resolve({ success: false, error: err.message });
        return;
      }

      if (!resolvedTarget || !fs.existsSync(resolvedTarget)) {
        resolve({ success: false, error: `Path not found: ${resolvedTarget || 'No project selected'}` });
        return;
      }

      // Try multiple methods to open VSCode
      const commands = [
        `code "${resolvedTarget}"`,
        `code-insiders "${resolvedTarget}"`,
        `start code "${resolvedTarget}"`,
      ];

      const tryCommand = (index) => {
        if (index >= commands.length) {
          // Fallback: just open the file/folder in explorer
          exec(`explorer "${resolvedTarget}"`, (err) => {
            if (err) {
              logger.error('CodeService: Failed to open VSCode or explorer:', err.message);
              resolve({ success: false, error: 'Could not open VSCode. Make sure "code" command is in your PATH.' });
            } else {
              resolve({ success: true, message: `Opened in File Explorer: ${resolvedTarget}` });
            }
          });
          return;
        }

        exec(commands[index], (error) => {
          if (error) {
            tryCommand(index + 1);
          } else {
            const displayPath = this.projectPath
              ? path.relative(this.projectPath, resolvedTarget)
              : resolvedTarget;
            resolve({
              success: true,
              message: `Opened in VSCode: ${displayPath}`,
              target: resolvedTarget,
            });
          }
        });
      };

      tryCommand(0);
    });
  }

  /**
   * Fix code in a file (replace content)
   */
  fixFile(filePath, oldContent, newContent) {
    try {
      const resolvedPath = this.resolvePath(filePath);
      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      const currentContent = fs.readFileSync(resolvedPath, 'utf-8');

      if (oldContent && currentContent.includes(oldContent)) {
        const updatedContent = currentContent.replace(oldContent, newContent);
        fs.writeFileSync(resolvedPath, updatedContent, 'utf-8');
        return {
          success: true,
          path: resolvedPath,
          message: `Fixed code in ${path.basename(resolvedPath)}`,
          diff: 'Content replaced successfully',
        };
      } else if (!oldContent) {
        // If no old content specified, write the entire file
        fs.writeFileSync(resolvedPath, newContent, 'utf-8');
        return {
          success: true,
          path: resolvedPath,
          message: `Replaced entire content of ${path.basename(resolvedPath)}`,
        };
      } else {
        return {
          success: false,
          error: `Could not find the specified code block in ${filePath}. The file may have been modified.`,
        };
      }
    } catch (error) {
      logger.error('CodeService fixFile error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * List files in the project directory
   */
  listFiles(dirPath = '', depth = 2) {
    try {
      const basePath = dirPath ? this.resolvePath(dirPath) : this.projectPath;
      if (!basePath || !fs.existsSync(basePath)) {
        return { success: false, error: 'Directory not found' };
      }

      const files = [];
      const walkDir = (currentPath, currentDepth) => {
        if (currentDepth > depth) return;
        try {
          const entries = fs.readdirSync(currentPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
              files.push({
                name: entry.name,
                path: fullPath,
                relativePath: this.projectPath ? path.relative(this.projectPath, fullPath) : fullPath,
                type: 'directory',
              });
              walkDir(fullPath, currentDepth + 1);
            } else {
              const stats = fs.statSync(fullPath);
              files.push({
                name: entry.name,
                path: fullPath,
                relativePath: this.projectPath ? path.relative(this.projectPath, fullPath) : fullPath,
                type: 'file',
                size: stats.size,
                extension: path.extname(fullPath),
              });
            }
          }
        } catch { /* skip permission errors */ }
      };

      walkDir(basePath, 0);
      return { success: true, files, count: files.length, basePath };
    } catch (error) {
      logger.error('CodeService listFiles error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a terminal command
   */
  executeCommand(command, cwd = null) {
    return new Promise((resolve) => {
      const workingDir = cwd || this.projectPath || process.cwd();

      logger.info(`CodeService executing command: ${command} in ${workingDir}`);

      exec(command, { cwd: workingDir, timeout: 30000 }, (error, stdout, stderr) => {
        const result = {
          success: !error,
          command,
          cwd: workingDir,
          stdout: stdout?.trim() || '',
          stderr: stderr?.trim() || '',
          exitCode: error?.code || 0,
        };

        if (error && error.killed) {
          result.error = 'Command timed out (30s limit)';
        } else if (error) {
          result.error = error.message;
        }

        resolve(result);
      });
    });
  }

  /**
   * Resolve a path against the project path.
   * Enforces project boundary — absolute paths outside the project
   * are rejected, and relative path traversal (../) is blocked.
   */
  resolvePath(filePath, createDir = false) {
    if (!this.projectPath) {
      // If no project path, resolve relative to current working dir
      return path.resolve(filePath);
    }

    let resolvedPath;

    if (path.isAbsolute(filePath)) {
      // Absolute path — only allow if it's within the project directory
      resolvedPath = path.resolve(filePath);
    } else {
      // Relative path — join with project path
      resolvedPath = path.resolve(this.projectPath, filePath);
    }

    // Enforce project boundary: resolved path MUST be inside projectPath
    const normalizedProject = path.resolve(this.projectPath);
    const normalizedResolved = path.resolve(resolvedPath);

    // On Windows, paths are case-insensitive — normalize for comparison
    let projectCheck = normalizedProject;
    let resolvedCheck = normalizedResolved;
    if (process.platform === 'win32') {
      projectCheck = normalizedProject.toLowerCase();
      resolvedCheck = normalizedResolved.toLowerCase();
    }

    if (!resolvedCheck.startsWith(projectCheck + path.sep) &&
        resolvedCheck !== projectCheck) {
      // Path traversal detected — block it
      const errMsg = `Access denied: path "${filePath}" is outside the project directory`;
      logger.error(`CodeService: ${errMsg}`);
      throw new Error(errMsg);
    }

    return normalizedResolved;
  }
}

module.exports = new CodeService();
