# Nexrad Radar Services

Nexrad Radar Services plot REF images on a google static map.

[Demo](https://KurtXiaoZ.github.io/Nexrad-Demo-Client) -- click the topright radar icon after selecting your radars

## Inverse Nearest-neighbor Interpolation Algorithm
In order to project a radar plot to a given google static map image:
```
1. Iterate through each pixel A of a given google static map image
2. Project from image location(x/y) to earth location(lat/lng)
3. Locate the pixel B of the radar plot that maps to the earth location
4. Overwrite A with B
```