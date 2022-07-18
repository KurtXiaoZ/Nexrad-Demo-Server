const NexradRadar = require('./src/nexrad');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 8443;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('outputs'));
app.listen(port, () => {
  console.log(`Example app listening at port:${port}`);
});

app.post('/plot', async (req, res) => {
    let nexradRadar = new NexradRadar();
    const { lat, lng, zoom, mapType, filteredRadars } = req.body;
    const fileName = await nexradRadar.plotRadarImages(lat, lng, 2000, 2000, zoom, mapType, filteredRadars);
    nexradRadar = null;
    setTimeout(() => {
        fs.unlink(`./outputs/${fileName}.png`, (err => {
            if (err) console.log(err);
            else console.log(`${fileName} deleted`);
          }));
    }, 120000)
    res.send({fileName});
});