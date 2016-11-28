This is a library used in [Byteball](https://byteball.org) clients.  Never used directly.  Some of the clients that require the library:

* [Byteball](../../../byteball) - GUI wallet for Mac, Windows, Linux, iOS, and Android.
* [Headless Byteball](../../../headless-byteball) - headless wallet, primarily for server side use.
* [Byteball Relay](../../../byteball-relay) - relay node for Byteball network.  It doesn't hold any private keys.
* [Byteball Hub](../../../byteball-hub) - hub for Byteball network.  Includes the relay, plus can store and forward end-to-end encrypted messages among devices on the Byteball network.

## Configuring

The default settings are in the library's [conf.js](conf.js), they can be overriden in your project root's conf.js (see the clients above as examples), then in conf.json in the app data folder.  The app data folder is:

* macOS: `~/Library/Application Support/<appname>`
* Linux: `~/.config/<appname>`
* Windows: `%LOCALAPPDATA%\<appname>`

`<appname>` is `name` in your `package.json`.

### Settings

This is the list of some of the settings that the library understands (your app can add more settings that only your app understands):

#### conf.port

The port to listen on, the default is 6611.  If you don't want to accept incoming connections at all, set port to `null`.  If you do want to listen, you will usually have a proxy, such as nginx, accept websocket connections on standard port 443 and forward them to your byteball daemon that listens on port 6611 on the local interface.

#### conf.storage

Storage backend -- mysql or sqlite, the default is sqlite.  If sqlite, the database files are stored in the app data folder.  If mysql, you need to also initialize the database with [byteball.sql](byteball.sql) and set connection params, e.g. in conf.json in the app data folder:

```json
{
	"port": 6611,
	"storage": "mysql",
	"database": {
		"max_connections": 30,
		"host"     : "localhost",
		"user"     : "byteball",
		"password" : "yourmysqlpassword",
		"name"     : "byteball"
	}
}
```
#### conf.bLight

Work as light client (`true`) or full node (`false`).  The default is full client.

#### conf.bServeAsHub

Whether to serve as hub on the Byteball network (store and forward e2e-encrypted messages for devices that connect to your hub).  The default is `false`.

#### conf.myUrl

If your node accepts incoming connections, this is its URL.  The node will share this URL with all its outgoing peers so that they can reconnect in any direction in the future.  By default the node doesn't share its URL even if it accepts connections.

#### MySQL conf for faster syncing

To lower disk load and increase sync speed, you can optionally disable flushing to disk every transaction, instead doing it once a second. This can be done by setting `innodb_flush_log_at_trx_commit=0` in your MySQL server config file (my.ini)

## Accepting incoming connections

Byteball network works over secure WebSocket protocol wss://.  To accept incoming connections, you'll need a valid TLS certificate (you can get a free one from [letsencrypt.org](https://letsencrypt.org)) and a domain name (you can get a free domain from [Freenom](http://www.freenom.com/)).  Then you accept connections on standard port 443 and proxy them to your locally running byteball daemon.

This is an example configuration for nginx to accept websocket connections at wss://byteball.one/bb and forward them to locally running daemon that listens on port 6611:

```nginx
server {
	listen 80 default_server;
	listen [::]:80 default_server;
	listen 443 ssl;
	listen [::]:443 ssl;
	ssl_certificate "/etc/letsencrypt/live/byteball.one/fullchain.pem";
	ssl_certificate_key "/etc/letsencrypt/live/byteball.one/privkey.pem";

	if ($host != "byteball.one") {
		rewrite ^(.*)$ https://byteball.one$1 permanent;
	}
	if ($https != "on") {
		rewrite ^(.*)$ https://byteball.one$1 permanent;
	}

	location = /bb {
		proxy_pass http://localhost:6611;
		proxy_http_version 1.1;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
	}

	root /var/www/html;
	server_name _;
}
```


