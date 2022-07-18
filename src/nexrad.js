

const utils = require('./util');
const SphericalMercator = require('sphericalmercator');
const merc = new SphericalMercator({size:256});
const JIMP = require('jimp');
const { Level2Radar } = require('nexrad-level-2-data');
const { plot } = require('nexrad-level-2-plot');
const AWS = require('aws-sdk');
const RADAR_LOCATIONS = require('./RadarLocations');
const _ = require('lodash');

const PRECISION = 7; // 6 or 5 is probably safe
const NEXRAD_SIZE = 3600; // size of a nexrad radar image
const RANGE = 460; // the range of nexrad-level-3-plot is 460km for radius
const PIXELWIDTH = RANGE / (NEXRAD_SIZE / 2); // the width of a pixel for nexrad-level-3-plot
const BUCKET = 'noaa-nexrad-level2'; // bucket name for aws nexrad service

// configure aws-sdk
AWS.config.update({accessKeyId: 'AKIAULYK6YJBATQLK7FJ'/*process.env.AWS_ACCESSKEYID*/, secretAccessKey: /*process.env.AWS_SECRETACESSKEY*/'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', region: 'us-east-1'});
const s3 = new AWS.S3();

class NexradRadar {
    constructor() {

    }
    async _renderJIMPImage(data, width, height) {
        let image = await new JIMP(width, height);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const dataIndex = (y * width * 4) + (x * 4);
                if (!(data[dataIndex] === 0 && data[dataIndex + 1] === 0 && data[dataIndex + 2] === 0 && data[dataIndex + 3] === 0)) {
                    image.setPixelColour(JIMP.rgbaToInt(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2], data[dataIndex + 3]), x, y);
                }
            }
        }
        return image;
    }
    _coordsAt(x, y, map) {
        x = Math.ceil(x / map.scale);
        y = Math.ceil(y / map.scale);
        let centerLl = [map.center.lon, map.center.lat];
        let centerPx = merc.px(centerLl, map.zoom);
        let targetPx = [centerPx[0] + parseInt(x), centerPx[1] - parseInt(y)];
        let targetLl = merc.ll(targetPx, map.zoom); // long lat
        let coords = {lat: targetLl[1], lon: targetLl[0]}
        if (coords.lon < -180) coords.lon = coords.lon + 360;
        if (coords.lon > 180) coords.lon = coords.lon - 360;
        return coords;
    }
    _pixelsAt(lat, lon, map) {
        const curPx = merc.px([map.center.lon, map.center.lat], map.zoom); // current latlon in px
        const targetPx = merc.px([lon, lat], map.zoom); // new latlon in px
        const pixelsXY = {x: (targetPx[0] - curPx[0]), y: -(targetPx[1] - curPx[1])}; // difference in px
        return {x: pixelsXY.x * map.scale, y: pixelsXY.y * map.scale}; // adjust it to map's scale
    }
    _getGoogleParams(options) {
        return `https://maps.googleapis.com/maps/api/staticmap?`
            + `center=${options.center.lat},${options.center.lon}`
            + `&size=${options.width}x${options.height}`
            + `&key=${/*process.env.MAP_APIKEY*/'AIzaSyDn0rwuFU4XbHCGkOucJ66s9KT2qzBxO2E'}`
            + `&zoom=${options.zoom}`
            + `&maptype=${options.mapType}`;
    }
    _toPrecision(number, precisionLimit) {
        return parseFloat(number).toFixed(precisionLimit);
    }
    _getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
        let p = 0.017453292519943295;    // Math.PI / 180
        let c = Math.cos;
        let a = 0.5 - c((lat2 - lat1) * p)/2 +
            c(lat1 * p) * c(lat2 * p) *
            (1 - c((lon2 - lon1) * p))/2;
        return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
    }
    _getBoundingBox(fsLatitude, fsLongitude, fiDistanceInKM) {
        if (fiDistanceInKM === null || fiDistanceInKM === undefined || fiDistanceInKM === 0)
            fiDistanceInKM = 1;
        let MIN_LAT, MAX_LAT, MIN_LON, MAX_LON, ldEarthRadius, ldDistanceInRadius, lsLatitudeInDegree, lsLongitudeInDegree,
            lsLatitudeInRadius, lsLongitudeInRadius, lsMinLatitude, lsMaxLatitude, lsMinLongitude, lsMaxLongitude, deltaLon;
        const degreeToRadius = (num) => {
            return num * (Math.PI / 180);
        }
        const radiusToDegree = (rad) => {
            return (180 * rad) / Math.PI;
        }
        // coordinate limits
        MIN_LAT = degreeToRadius(-90);
        MAX_LAT = degreeToRadius(90);
        MIN_LON = degreeToRadius(-180);
        MAX_LON = degreeToRadius(180);
        // Earth's radius (km)
        ldEarthRadius = 6378.1;
        // angular distance in radians on a great circle
        ldDistanceInRadius = fiDistanceInKM / ldEarthRadius;
        // center point coordinates (deg)
        lsLatitudeInDegree = fsLatitude;
        lsLongitudeInDegree = fsLongitude;
        // center point coordinates (rad)
        lsLatitudeInRadius = degreeToRadius(lsLatitudeInDegree);
        lsLongitudeInRadius = degreeToRadius(lsLongitudeInDegree);
        // minimum and maximum latitudes for given distance
        lsMinLatitude = lsLatitudeInRadius - ldDistanceInRadius;
        lsMaxLatitude = lsLatitudeInRadius + ldDistanceInRadius;
        // minimum and maximum longitudes for given distance
        lsMinLongitude = void 0;
        lsMaxLongitude = void 0;
        // define deltaLon to help determine min and max longitudes
        deltaLon = Math.asin(Math.sin(ldDistanceInRadius) / Math.cos(lsLatitudeInRadius));
        if (lsMinLatitude > MIN_LAT && lsMaxLatitude < MAX_LAT) {
            lsMinLongitude = lsLongitudeInRadius - deltaLon;
            lsMaxLongitude = lsLongitudeInRadius + deltaLon;
            if (lsMinLongitude < MIN_LON) {
                lsMinLongitude = lsMinLongitude + 2 * Math.PI;
            }
            if (lsMaxLongitude > MAX_LON) {
                lsMaxLongitude = lsMaxLongitude - 2 * Math.PI;
            }
        }
        // a pole is within the given distance
        else {
            lsMinLatitude = Math.max(lsMinLatitude, MIN_LAT);
            lsMaxLatitude = Math.min(lsMaxLatitude, MAX_LAT);
            lsMinLongitude = MIN_LON;
            lsMaxLongitude = MAX_LON;
        }
    
        return {
            minLat: radiusToDegree(lsMinLatitude),
            minLng: radiusToDegree(lsMinLongitude),
            maxLat: radiusToDegree(lsMaxLatitude),
            maxLng: radiusToDegree(lsMaxLongitude)
        };
    }
    _configureMap(latitude, longitude, width, height, zoom, mapType) {
        const scale = width <= 640 && height <= 640 ? 1 : 2;
        return {
            center: {
                lat: this._toPrecision(latitude, PRECISION),
                lon: this._toPrecision(longitude, PRECISION)
            },
            width: (width / scale),
            height: (height / scale),
            zoom: zoom,
            scale,
            mapType,
        };
    }
    async _downloadSingle(radar) {
        if (RADAR_LOCATIONS[radar] === undefined) return '';
        const today = new Date();
        const tomorrow = new Date(today.getTime() + (24 * 60 * 60 * 1000));
        let params = {
            Bucket: BUCKET,
            Delimiter: '/',
            Prefix: `${tomorrow.getFullYear()}/${(tomorrow.getMonth() + 1).toString().padStart(2,'0')}/${tomorrow.getDate().toString().padStart(2,'0')}/${radar}/`
        };
        let dataTomorrow = await s3.listObjects(params).promise();
        if (dataTomorrow.Contents.length === 0) {
            params = {
                Bucket: BUCKET,
                Delimiter: '/',
                Prefix: `${today.getFullYear()}/${(today.getMonth() + 1).toString().padStart(2,'0')}/${today.getDate().toString().padStart(2,'0')}/${radar}/`
            };
            let dataToday = await s3.listObjects(params).promise();
            if (dataToday.Contents.length !== 0) {
                let nexradKey = dataToday.Contents[dataToday.Contents.length - 1].Key;
                if (nexradKey.substr(nexradKey.length - 3) === 'MDM') {
                    nexradKey = dataToday.Contents[dataToday.Contents.length - 2].Key;
                }
                let nexradToday = await s3.getObject({Bucket: BUCKET, Key: nexradKey}).promise();
                return nexradToday.Body;
            }
        }
        else {
            let nexradKey = dataTomorrow.Contents[dataTomorrow.Contents.length - 1].Key;
            if (nexradKey.substr(nexradKey.length - 3) === 'MDM') {
                nexradKey = dataTomorrow.Contents[dataTomorrow.Contents.length - 2].Key;
            }
            let nexradTomorrow = await s3.getObject({Bucket: BUCKET, Key: nexradKey}).promise();
            return nexradTomorrow.Body;
        }
        return '';
    }
    async _getMap(settings) {
        const queryString = this._getGoogleParams(settings);
        return await JIMP.read(queryString);
    }
    _parseNexrad(data) {
        const tmp = new Level2Radar(data);
        const nexradPlot = plot(tmp, 'REF', {background: 'white', elevation: 1}).REF.canvas;
        return (nexradPlot
            .getContext('2d')
            .getImageData(0, 0, NEXRAD_SIZE, NEXRAD_SIZE));
    }
    async _filterRadars(radars, settings, zoom) {    
        const cen = this._coordsAt(0, 0, settings);
        let bound = 0;
        if(zoom <= 4) bound = RANGE * 1.5;
        else if(zoom <= 8) bound = RANGE * 0.5;
        else bound = RANGE * 0.3;
        radars.sort((a, b) => {
            let disA = this._getDistanceFromLatLonInKm(RADAR_LOCATIONS[a][0], RADAR_LOCATIONS[a][1], cen.lat, cen.lon);
            let disB = this._getDistanceFromLatLonInKm(RADAR_LOCATIONS[b][0], RADAR_LOCATIONS[b][1], cen.lat, cen.lon);
            return disB - disA;
        });
    
        for (let i = 0; i < radars.length; ++i) {
            for (let j = radars.length - 1; j > i; --j) {
                const dist = this._getDistanceFromLatLonInKm(RADAR_LOCATIONS[radars[i]][0], RADAR_LOCATIONS[radars[i]][1], RADAR_LOCATIONS[radars[j]][0], RADAR_LOCATIONS[radars[j]][1]);
                if (dist <= bound) {
                    radars.splice(j, 1);
                }
            }
        }
        return radars;
    }
    async _addRadarPlot(radar, plot, radarPlot, settings) {
        const [latCen, lngCen] = RADAR_LOCATIONS[radar];
        const boundingBox = this._getBoundingBox(latCen, lngCen, RANGE);
    
        const c1 = this._pixelsAt(boundingBox.minLat, boundingBox.minLng, settings);
        const c2 = this._pixelsAt(boundingBox.maxLat, boundingBox.maxLng, settings);
        const xMin = c1.x, yMin = c1.y;
        const xMax = c2.x, yMax = c2.y;
    
        for (let i = xMin; i <= xMax; ++i) {
            const mapX = Math.floor(i / settings.scale) + settings.width / 2;
            if (mapX < 0 || mapX > settings.width) continue;
    
            const lng = this._coordsAt(i, 0, settings).lon;
            const disX = this._getDistanceFromLatLonInKm(latCen, lng, latCen, lngCen);
            const x = Math.sign(lng - lngCen) * Math.round(disX / PIXELWIDTH);
    
            for (let j = yMin; j <= yMax; ++j) {
                const mapY = settings.height / 2 - Math.floor(j / settings.scale);
                if (mapY < 0 || mapY > settings.height) continue;
    
                const lat = this._coordsAt(0, j, settings).lat;
                const disY = this._getDistanceFromLatLonInKm(lat, lngCen, latCen, lngCen);
                const y = Math.sign(lat - latCen) * Math.round(disY / PIXELWIDTH);
    
                const pxColor = plot.getPixelColor(x + NEXRAD_SIZE / 2, NEXRAD_SIZE / 2 - y);
                if (pxColor !== 0xffffffff) radarPlot.setPixelColor(pxColor, mapX, mapY);
            }
        }
    }
    async _draw(imageData) {
        const imageBuffer = await new Promise((resolve, reject) => {
            imageData.getBuffer(JIMP.MIME_PNG, (err, buffer) => {
                if (err) reject(err);
                else resolve(buffer);
            });
        });
        return imageBuffer;
    }
    listRadars(latitude, longitude, width, height, zoom) {
        const res = [];
        if(zoom === 1 || zoom === 2) {
            for (const i in RADAR_LOCATIONS) {
                res.push(i);
            }
            return res;
        }
        const settings = this._configureMap(latitude, longitude, width, height, zoom, 'terrain');
    
        let latMin = this._coordsAt(0, settings.height / -2, settings).lat;
        let latMax = this._coordsAt(0, settings.height, settings).lat;
        let lngMin = this._coordsAt(settings.width / -2, 0, settings).lon;
        let lngMax = this._coordsAt(settings.width / 2, 0, settings).lon;
        latMin = this._getBoundingBox(latMin, lngMin, RANGE).minLat;
        latMax = this._getBoundingBox(latMax, lngMax, RANGE).maxLat;
        lngMin = this._getBoundingBox(latMin, lngMin, RANGE).minLng;
        lngMax = this._getBoundingBox(latMax, lngMax, RANGE).maxLng;
        
        for (const i in RADAR_LOCATIONS) {
            const [lat, lng] = RADAR_LOCATIONS[i];
            if (lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax) {
                res.push(i);
            }
        }
        return res;
    }
    async plotRadarImages(latitude, longitude, width, height, zoom, mapType, radars=null) {
        const fileName = utils.makeid(9);
        const settings = await this._configureMap(latitude, longitude, width, height, zoom, mapType);
        if(!radars || radars.length === 0) {
            let map = await this._getMap(settings);
            await map.write(`./outputs/${fileName}.png`);
            map = null;
            return fileName;
        }
        if(radars.length > 5) {
            radars = await this._filterRadars(radars, settings, zoom);
        }
        let radarPlot = await new JIMP(settings.width, settings.height, 0x0);
    
        let allRadarsData = await Promise.all(radars.map(this._downloadSingle));
        let [usedRadars = [], radarsData = []] = _.unzip(_.zip(radars, allRadarsData).filter(s => s[1]));
        let radarsParsed = await Promise.all(radarsData.map(this._parseNexrad));
        let radarsImgs = await Promise.all(radarsParsed.map(p => this._renderJIMPImage(p.data, NEXRAD_SIZE, NEXRAD_SIZE)));
        await Promise.all(_.zip(usedRadars, radarsImgs).map(v => this._addRadarPlot(v[0], v[1], radarPlot, settings)));
    
        if (mapType !== 'none') {
            const map = await this._getMap(settings);
            await map.composite(radarPlot, 0, 0);
            await map.write(`./outputs/${fileName}.png`);
        }
        // else console.log(await this._draw(radarPlot));
        else await radarPlot.write(`./outputs/${fileName}.png`);
        radarPlot = null;
        allRadarsData = null;
        usedRadars = null;
        radarsData = null;
        radarsParsed = null;
        radarsImgs = null;
        return fileName;
    }
}

module.exports = NexradRadar;