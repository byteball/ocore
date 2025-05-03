# O<sub>byte</sub> core library (O<sub>core</sub>)

This is a library used in [O<sub>byte</sub>](https://obyte.org) clients.  Some of the clients that require the library:

* [GUI wallet](https://github.com/byteball/obyte-gui-wallet) - GUI wallet for Mac, Windows, Linux, iOS, and Android.
* [Headless wallet](https://github.com/byteball/headless-obyte) - headless wallet, primarily for server side use.
* [O<sub>byte</sub> Relay](https://github.com/byteball/obyte-relay) - relay node for O<sub>byte</sub> network.  It doesn't hold any private keys.
* [O<sub>byte</sub> Hub](https://github.com/byteball/obyte-hub) - hub for O<sub>byte</sub> network.  Includes the relay, plus can store and forward end-to-end encrypted messages among devices on the O<sub>byte</sub> network.

## Developer guides

See the [Developer resources site](https://developer.obyte.org).  Also, you'll find loads of examples in other [O<sub>byte</sub> repositories](https://github.com/byteball). For internal APIs, see the `exports` of node.js modules.

This repo is normally used as a library and not installed on its own, but if you are contributing to this project then fork, `git pull`, `npm install`, and `npm test` to run the tests.

## Configuring

The default settings are in the library's [conf.js](conf.js), they can be overridden in your project root's conf.js (see the clients above as examples), then in conf.json in the app data folder.  The app data folder is:

* macOS: `~/Library/Application Support/<appname>`
* Linux: `~/.config/<appname>`
* Windows: `%LOCALAPPDATA%\<appname>`

`<appname>` is `name` in your `package.json`.

### Settings

This is the list of some of the settings that the library understands (your app can add more settings that only your app understands):

#### conf.port

The port to listen on.  If you don't want to accept incoming connections at all, set port to `null`, which is the default.  If you do want to listen, you will usually have a proxy, such as nginx, accept websocket connections on standard port 443 and forward them to your O<sub>byte</sub> daemon that listens on port 6611 on the local interface.

#### conf.storage

Storage backend -- mysql or sqlite, the default is sqlite.  If sqlite, the database files are stored in the app data folder.  If mysql, you need to also initialize the database with [SQL file](initial-db/byteball-mysql.sql) and set connection params, e.g. in conf.json in the app data folder:

```json
{
	"port": 6611,
	"storage": "mysql",
	"database": {
		"max_connections": 30,
		"host"     : "localhost",
		"user"     : "obyte_user",
		"password" : "yourmysqlpassword",
		"name"     : "obyte_db"
	}
}
```
#### conf.bLight

Work as light client (`true`) or full node (`false`).  The default is full client.

#### conf.bServeAsHub

Whether to serve as hub on the O<sub>byte</sub> network (store and forward e2e-encrypted messages for devices that connect to your hub).  The default is `false`.

#### conf.myUrl

If your node accepts incoming connections, this is its URL.  The node will share this URL with all its outgoing peers so that they can reconnect in any direction in the future.  By default the node doesn't share its URL even if it accepts connections.

#### conf.bWantNewPeers

Whether your node wants to learn about new peers from its current peers (`true`, the default) or not (`false`).  Set it to `false` to run your node in stealth mode so that only trusted peers can see its IP address (e.g. if you have online wallets on your server and don't want potential attackers to learn its IP).

#### conf.socksHost and conf.socksPort

Settings for connecting through optional SOCKS5 proxy.  Use them to connect through TOR and hide your IP address from peers even when making outgoing connections.  This is useful and highly recommended when you are running an online wallet on your server and want to make it harder for potential attackers to learn the IP address of the target to attack.  DNS queries are always routed through the proxy if it is enabled.

#### conf.httpsProxy

Setting for connecting through an optional HTTPS proxy. Use it when your local network can only access the Internet via an http proxy server. When both socks5 and http proxy are set, socks5 takes precedence. The configuration value is the full URL to the proxy server, eg. `http://proxy:3128`

#### conf.smtpTransport, conf.smtpRelay, conf.smtpPort, conf.smtpUser, and conf.smtpPassword

Settings for sending email. They are used e.g. if your node needs to send notifications. `smtpTransport` can take one of three values:
* `local`: send email using locally installed `sendmail`. Normally, `sendmail` is not installed by default and when installed, it needs to be properly configured to actually send emails. If you choose this option, no other conf settings are required for email. This is the default option.
* `direct`: send email by connecting directly to the recipient's SMTP server. This option is not recommended.
* `relay`: send email through a relay server, like most email apps do. You need to also configure the server's host `smtpRelay`, its port `smtpPort` if it differs from the default port 25, and `smtpUser` and `smtpPassword` for authentication to the server.

#### MySQL conf for faster syncing

To lower disk load and increase sync speed, you can optionally disable flushing to disk every transaction, instead doing it once a second. This can be done by setting `innodb_flush_log_at_trx_commit=0` in your MySQL server config file (my.ini)

## Accepting incoming connections

O<sub>byte</sub> network works over secure WebSocket protocol wss://.  To accept incoming connections, you'll need a valid TLS certificate (you can get a free one from [letsencrypt.org](https://letsencrypt.org)) and a domain name (you can get a free domain from [Freenom](http://www.freenom.com/)).  Then you accept connections on standard port 443 and proxy them to your locally running O<sub>byte</sub> daemon.

This is an example configuration for nginx to accept websocket connections at wss://byteball.one/bb and forward them to locally running daemon that listens on port 6611:

If your server doesn't support IPv6, comment or delete the two lines containing [::] or nginx won't start

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

By default Node limits itself to 1.76GB the RAM it uses. If you accept incoming connections, you will likely reach this limit and get this error after some time:
```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
1: node::Abort() [node]
...
...
12: 0x3c0f805c7567
Out of memory
```
To prevent this, increase the RAM limit by adding `--max_old_space_size=<size>` to the launch command where size is the amount in MB you want to allocate.

For example `--max-old-space-size=4096`, if your server has at least 4GB available.

## Donations

We accept donations through [Kivach](https://kivach.org) and forward a portion of the donations to other open-source projects that made Obyte possible.

[![Kivach](https://kivach.org/api/banner?repo=byteball/ocore)](https://kivach.org/repo/byteball/ocore)
