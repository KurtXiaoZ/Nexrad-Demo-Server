// turns a tuple-like object into query friendly string
const encodeQueryData = (query, encode=true) => {
    let ret = [];

    Object.entries(query).forEach(entry => {
        if (encode) entry = entry.map(d => encodeURIComponent(d));
        const [key, value] = entry;
        ret.push(`${key}=${value}`);
    });
    return ret.join('&');
};

const makeid = (length) => {
    var result           = '';
    var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}


module.exports = {
    encodeQueryData,
    makeid,
};
