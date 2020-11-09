const fs = require('fs-extra');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const cors = require('cors');
const {v4: uuidv4} = require('uuid');
const commandLineArgs = require('command-line-args');
const bodyParser = require('body-parser')
let express = require('express');
let createError = require('http-errors');
const axios = require('axios').default;
const pkg = require('./package.json');

const executor = require('./lib/executor')
let usersRouter = require('./routes/users');
const index = require('./routes/index');
let configJSON = require('./appproperties.json');
const endpointHash = index.endpointHash;
const indexRouter = index.router;

morgan.token('id', function getId(req) {
    return req.id;
})

const kgridProxyAdapterUrl = process.env.KGRID_PROXY_ADAPTER_URL || configJSON.kgrid_proxy_adapter_url;
const environmentSelfUrl = process.env.KGRID_NODE_ENV_URL || configJSON.kgrid_node_env_url;
console.log(`KGrid Node Runtime ${pkg.version}\n\n`)
console.log(`Setting Urls from Environment Variables:
\nKGRID_PROXY_ADAPTER_URL: ${kgridProxyAdapterUrl}
\nKGRID_NODE_ENV_URL: ${environmentSelfUrl}
`);
let app = express();

const optionDefinitions = [
    {name: 'shelf', alias: 's', type: String, defaultOption: false}
]
const options = commandLineArgs(optionDefinitions, {partial: true})

let shelfPath = options.shelf || path.join(process.cwd(), 'shelf')
fs.ensureDirSync(shelfPath)

let contextFile = path.join(shelfPath, "context.json")
if (!fs.pathExistsSync(contextFile)) {
    fs.ensureFileSync(contextFile)
    fs.writeJSONSync(contextFile, {}, {spaces: 4})
}
let packageFile = path.join(shelfPath, "package.json")
if (!fs.pathExistsSync(packageFile)) {
    fs.ensureFileSync(packageFile)
    fs.writeJSONSync(packageFile, {"name": "expressactivatorshelf"}, {spaces: 4})
}

app.locals.shelfPath = shelfPath

app.locals.info = {};
app.locals.info.app = pkg.name
app.locals.info.version = pkg.version
app.locals.info.engine = "node";
app.locals.info.status = "up";
app.locals.info.url = environmentSelfUrl;
app.locals.info.activatorUrl = "";

global.cxt = {
    map: {},
    getExecutorByHash(key) {
        if (this.map[key]) {
            return this.map[key].executor
        } else {
            return null
        }
    },

    getExecutorByID(uri) {
        let e = this.map[endpointHash(uri)]
        return e.executor
    },
}
global.cxt.map = require(contextFile)
if (Object.keys(global.cxt.map).length > 0) {
    for (let key in global.cxt.map) {
        if (global.cxt.map[key].status === 'Activated') {
            const exec = Object.create(executor);
            exec.init(global.cxt.map[key].src);
            global.cxt.map[key].executor = exec
        }
    }
}
fs.createWriteStream(path.join(__dirname, 'access.log'), {flags: 'a'})
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');
app.use(cors())
app.use(assignId)

if (process.env.DEBUG) {
    app.use(morgan('dev'))
}

app.use(express.json());
app.use(bodyParser.text())
app.use(express.urlencoded({extended: false}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(function (err, req, res) {
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};
    res.status(err.status || 500);
    res.render('error');
});

axios.post(kgridProxyAdapterUrl + "/proxy/environments",
    {"engine": "node", "url": environmentSelfUrl})
    .then(function (response) {
        console.log("Registered remote environment in activator at " + kgridProxyAdapterUrl + " with resp "
            + JSON.stringify(response.data));
        app.locals.info.activatorUrl = kgridProxyAdapterUrl;
        axios.get(kgridProxyAdapterUrl + "/activate/node")
            .catch(function (error) {
                console.log(error.message)
            });
    })
    .catch(function (error) {
        if (error.response) {
            console.log(error.response.data);
        } else {
            console.log(error.message);
        }
    });

function assignId(req, res, next) {
    req.id = uuidv4()
    next()
}

module.exports = app;
