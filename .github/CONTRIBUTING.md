# Style Guide

This document defines the code style rules for all byteball projects, i.e. all projects under https://github.com/byteball, not just this repo byteballcore.

## General principle

All code must be easy to read with minimal contextual knowledge.  Code should read like English.  The name of every variable/object/function should clearly say what it is or what it does, without need to inspect its history or implementation.

Once the code is easy to read, it becomes also easy to rewrite.

### Naming

* camelCase or snake_case but never a mixture within the same name.
* Variable names: the main word must be a noun.
* Function names: the main word is usually a verb.  A function name must always signify an action.  Usually, it is an imperative sentence `doSomethingWithSomething()`, sometimes action is expressed in other clear ways `string2array()`, sometimes action is a reaction to an event `onEvent()`.
* Hungarian notation: use it when the type of a variable is not immediately evident from its name.  For example, `cities` could be an array or a string of comma-delimited city names, use `arrCities` or `strCities` to make the type clear.
* Long names are OK, clarity takes precedence.
* Widely accepted conventional names are OK, even if they are not descriptive enough.  Example: counter variables `i`, `j`, `k`.
* Use the least abstract names possible.  For example, `key`, `value` is OK for the code that deals with any keys and any values, but in most cases, we know a bit more about the objects that these variables represent and can give more specific names.
* The same entity must be named the same everywhere.  The same name in different functions or modules.  The same name as both js variable and sql column name.

### SQL

* Use only snake_case for table and column names
* Elements of SQL language must be in uppercase `SELECT COUNT(*) AS c FROM table_name`
* Use aliases for table and column names only when the alias is at least as clear as the original name.  For example, `SELECT * FROM sales s` would replace clear `sales` with cryptic `s`, don't do it.  Aliases of table names are justified when joining a table to itself `SELECT * FROM sales AS last_year_sales LEFT JOIN sales AS this_year_sales ON ...`
* When using aliases, always write `AS`.
* Table names must be in plural: table `cities`, not table `city` (unless the table can never contain more than one record).
* Don't rely on fixed table structure in INSERTs `INSERT INTO tab VALUES (?,?)`, always explicitly name the columns `INSERT INTO tab (clo1, col2) VALUES (?,?)`.
* In `GROUP BY` and `ORDER BY` use column names, not indexes.

### Coding

* Variables must have as small scope as possible.
* Single assignment is preferred over mutable state.
* Avoid using array indexes explicitly, especially large ones (2 and above).  Instead, assign the values to clearly named variables `let [year, month, day] = date.split('-')`
* Unless you are coding a performance critical piece of code, choose a simple, clear, straightforward algorithm, even if it is not optimal.
* Avoid large blocks of code.  Sometimes it makes sense to split them into several clearly named functions, even if the functions are called only once.
* Avoid circular references, keep a clear hierarchy of _using code_ and _provider code_.

### Tabs vs spaces

* We use tabs for indent
