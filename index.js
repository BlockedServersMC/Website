var crypto = require('crypto'),
	http = require('http'),
	path = require('path'),
	jethro = require('jethro'),
	bodyParser = require('body-parser'),
	express = require('express'),
	app = express(),
	mongoose = require('mongoose');

function log(severity, message, service) {
    if(!service) service = "app";
    jethro(severity, service, message);
}

function sha1(str) {
	return crypto.createHash('sha1').update(str).digest('hex');
}

var Server = mongoose.model('Server', {
		_id: String,
		hostname: String,
		currentlyBlocked: Boolean,
		hostnameFound: Boolean,
		lastBlocked: Date
	}),
	IPHash = mongoose.model('IPHash', {
		_id: String,
		hostname: String
	});

app.use(jethro.express);
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(express.static(path.join(__dirname, 'public')));

app.get('/count', function (req, res) {
	IPHash.count({}, function (err, count) {
		if(err) {
            res.status(500).json({
                success: false,
                message: "Database error!"
            }).end();
            log('error', err, "mongoose");
		}

        res.status(200).json({
            success: true,
			count: count
        }).end();
    })
});

app.get('/check', function(req, res) {
	res.status(400).json({
		success: false,
		message: "Missing query!"
	}).end();
});

app.get('/check/:query', function(req, res) {
	if(!/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3})$|^((([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9]))$/.test(req.params.query.toLowerCase())) {
		res.status(400).json({
			success: false,
			message: "Invalid query!"
		}).end();
		return;
	}
	var ipSplit = req.params.query.toLowerCase().split(".");
	var isIp = ipSplit.length == 4;
	var smallIp, starIp;
	var otherStars = [];
	if(isIp) {
		ipSplit.map(function(part) {
			try {
				new Number(part);
			} catch (ex) {
				isIp = false;
			}
		});
	}
	if(!isIp && ipSplit.length>=2) {
		smallIp = ipSplit[ipSplit.length-2]+"."+ipSplit[ipSplit.length-1];
		starIp = "*."+ipSplit[ipSplit.length-2]+"."+ipSplit[ipSplit.length-1];
		while (ipSplit.length > 3) {
                    ipSplit[0] = "*";
                    otherStars.push(ipSplit.join("."))
                    ipSplit.shift()
                }
	}
	new IPHash({
		_id: sha1(req.params.query.toLowerCase()),
		hostname: req.params.query.toLowerCase()
	}).save();
	if(smallIp!=null) {
		new IPHash({
			_id: sha1(smallIp.toLowerCase()),
			hostname: smallIp.toLowerCase()
		}).save();
		new IPHash({
			_id: sha1(starIp.toLowerCase()),
			hostname: starIp.toLowerCase()
		}).save();
		otherStars.map(function (star) {
                    new IPHash({
                        _id: sha1(star.toLowerCase()),
                        hostname: star.toLowerCase()
                    }).save();
                });
	}
	var query = (smallIp==null ? {_id: sha1(req.params.query.toLowerCase())} : {$or: [{_id: sha1(req.params.query.toLowerCase())}, {_id: sha1(smallIp)}, {_id: sha1(starIp)}]});
	Server.findOne(query, function(err, server) {
		if(err) {
			res.status(500).json({
				success: false,
				message: "Database error!"
			}).end();
			log('error', err, "mongoose");
			return;
		}
		if(server===null) {
			res.json({
				success: true,
				blocked: false,
				lastBlocked: null
			}).end();
		} else {
			res.status(200).json({
				success: true,
				blocked: server.currentlyBlocked,
				lastBlocked: server.lastBlocked
			});
			if(server.hostname == null) {
				IPHash.find({_id: server._id}, function(err, ipHash) {
					console.log(ipHash);
					if(err) {
						log('error', err, 'mongo');
					}
					server.hostname = (ipHash==null || ipHash.hostname==null ? req.params.query.toLowerCase() : ipHash.hostname);
					server.hostnameFound = true;
					server.save(function(err){
						if(err) {
							log('error', err, 'mongo');
						}
						res.end();
					});
				});
			} else {
				res.end();
			}
		}
	});
});

mongoose.connect(process.env.MONGO_URL||'mongodb://localhost/test', function(err){
	if(err) {
		console.log(err);
		process.exit(1);
	}
});
var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
	http.createServer(app).listen(process.env.PORT||3000, process.env.HOST||"0.0.0.0");
	log("debug", "Spawned Express on "+(process.env.HOST||"0.0.0.0")+":"+(process.env.PORT||3000), "express");
});
