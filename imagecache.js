function ImageCache(cacheKey, options) {

	if (!(this instanceof ImageCache)) {
        return new ImageCache(cacheKey, options);
	}

	if(_.isUndefined(cacheKey)) {
		Ti.API.error("You must specify unique persistent `cacheKey` for this cache instance. Warning: existen cache will be owerwrited!");
		return;
	} else {
		this._baseKey = 'com.falkolab.imagecache.' + cacheKey;
	}

	var configKey = this._baseKey + '.config';

	options = options || {};

	var config = _.extend(
		Ti.App.Properties.getObject(configKey, ImageCache.defaultConfig),
			_.pick(options, _.keys(ImageCache.defaultConfig)));

	Ti.App.Properties.setObject(configKey, config);

	var silentProps = false;

	Object.defineProperty(this, 'cacheKey', {
		value: cacheKey,
		writable: false
	});

	Object.defineProperty(this, 'baseDirectory', {
		get: function() { return config.baseDirectory; },
		set: function(value) {
			this.clearCache();
			config.baseDirectory = value;
			!silentProps && Ti.App.Properties.setObject(configKey, config);
		}
	});

	Object.defineProperty(this, 'folder', {
		get: function() { return config.folder; },
		set: function(value) {
			this.clearCache();
			config.folder = value;
			!silentProps && Ti.App.Properties.setObject(configKey, config);
		}
	});

	Object.defineProperty(this, 'lifetime', {
		get: function() { return config.lifetime;	},
		set: function(value) {
			this.flushExpired();
			config.lifetime = value;
			!silentProps && Ti.App.Properties.setObject(configKey, config);
		}
	});

	Object.defineProperty(this, 'debug', {
		get: function() { return config.debug; },
		set: function(value) {
			config.debug = value;
			!silentProps && Ti.App.Properties.setObject(configKey, config);
		}
	});

	Object.defineProperty(this, 'remoteBackup', {
		get: function() { return config.remoteBackup; },
		set: function(value) {
			config.remoteBackup = value;
			!silentProps && Ti.App.Properties.setObject(configKey, config);
		}
	});

	/** Bulk update configuration
	*/
	this.updateConfig = function(options) {
		silentProps = true;
		_.extend(this, _.pick(options, _.keys(ImageCache.defaultConfig)));
		silentProps = false;
		Ti.App.Properties.setObject(configKey, config);
	};
}

ImageCache.defaultConfig = {
	folder: 'ImageCache',
	lifetime: 43200, // half a day (in seconds)
	debug: false, // does console.log debug
	remoteBackup: true, // do you want the file(s) to be backed up to a remote cloud, like iCloud on iOS? Doesn't work on Android
	baseDirectory: Titanium.Filesystem.applicationDataDirectory // wher is files stored
};

ImageCache.prototype.d = function() {
	this.debug && Ti.API.debug('ImageCache [' + this.cacheKey + ']:', Array.prototype.slice.call(arguments).join(' '));
};

ImageCache.prototype.getFileList = function() {
	if(_.isUndefined(this._cachedFileList)) {
		this._cachedFileList = Ti.App.Properties.getList(this._baseKey + '.list',[]);
	}

	return this._cachedFileList;
};

ImageCache.prototype.setFileList = function(list) {
	this.d('Files in cache:', list.length);
	this._cachedFileList = list;
	Ti.App.Properties.setList(this._baseKey + '.list', list);
};

/**
 * Geting file cache-record if present
 */
ImageCache.prototype.getFileRecord = function(fileName){
	this.d('Looking for file in the system:', fileName);
    return _.findWhere(this.getFileList(), {fileName: fileName});
};

ImageCache.prototype.getFileRecordByUrl = function(url){
	return this.getFileRecord(Ti.Utils.md5HexDigest(url));
};

/**
 * Ensure is the directory been created yet?
 */
ImageCache.prototype.ensureDir = function() {
	var dir = Titanium.Filesystem.getFile(this.baseDirectory, this.folder);
	!dir.exists() && dir.createDirectory();
	return dir;
};

/**
 * Store the file
 * @param {String} fileName (needs to be unique, otherwise will overwrite)
 * @param {Blob} Blob of the image
 */
ImageCache.prototype.saveBlob = function(fileName, blob){
	this.d('Saving a blob', fileName);
	if (this.getFileRecord(fileName))	return;

	this.ensureDir();

	var file = Ti.Filesystem.getFile(this.baseDirectory, this.folder, fileName);

	if (file.write(blob)){
		if (Ti.Platform.name == 'iPhone OS'){
			file.remoteBackup = this.remoteBackup;
		}
	}

	file = null;

	var list = this.getFileList();
	list.push({
		fileName: fileName,
		addedAt: Date.now(),
		fileSize: blob.length,
		lifetime: this.lifetime,
		folder: this.folder
	});

	this.setFileList(list);
	list = null;
};

/**
 * read file from filesystem
 */
ImageCache.prototype.readFile = function(fileName){
	this.d('Reading file', fileName);

	var fileRecord = this.getFileRecord(fileName);
	if(!fileRecord) {
		throw "File " + fileName + " not found!";
	}

	return Ti.Filesystem.getFile(this.baseDirectory,
		fileRecord.folder, fileName).read();
};

/**
 * Returns total cache in bytes
 */
ImageCache.prototype.cacheSize = function(){
	this.d('Calculating cache size ...');
	return _.reduce(this.getFileList(), function(sum, record){
		return sum + record.fileSize;
	}, 0);
};

/**
 * Clear the cache entirely
 */
ImageCache.prototype.clearCache = function(){
	this.d('Completely cleaning cache');
	this.removeFiles(_.pluck(this.getFileList(), 'fileName'));
};

/**
 * Clear only cache files that are older than cache expiry time
 */
ImageCache.prototype.flushExpired = function(){
	this.d('Flush expired files');

	var removeFiles = [];
	this.removeFiles(_.chain(this.getFileList()).filter(function(fileRecord){
		if (Date.now() - (fileRecord.addedAt + (fileRecord.lifetime * 1000)) > 0){
			this.d('Found expired file ' + fileRecord.fileName + ', removing');
			return true;
		}
		return false;
	}).pluck("fileName").value());
};

/**
 * Remove a file based on internal fileName
 * Note: fileName is generated by To.ImageCache
 * @param {String} fileName of the image
 */
ImageCache.prototype.removeFiles = function(){
	var nameList = Array.prototype.slice.call(arguments);
	this.d('Removing', nameList.length, 'files');

	var list = this.getFileList();
	var result = _.chain(nameList).map(function(fileName) {
		var fileRecord = this.getFileRecord(fileName);
		if (!fileRecord){
			return null;
		}

		var file = Ti.Filesystem.getFile(this.baseDirectory, fileRecord.folder, fileRecord.fileName);

		if (!file.exists()){
			this.d('File ' + fileName + ' has aleady been removed');
			return fileRecord;
		}

		if (file.deleteFile()){
			this.d('File ' + fileName + ' has been removed');
			return fileRecord;
		}

		file = null;
	}, this).filter(function(value) {
		return !!value;
	}).value();

	this.setFileList(_.without(list, result));
	result = null;
};

/**
 * Remove a file based on URL from cache.
 * @param {String} URL of the image
 */
ImageCache.prototype.removeByUrl = function(url) {
	this.d('Removing file based on URL', url);
	this.removeFile(Ti.Utils.md5HexDigest(url));
};

/**
 * This function will always return a blob, wether it was cached or not.
 * Therefore, only use this function if you want to cache it.
 * @param {String} url
 */
ImageCache.prototype.load = function(url) {
	var fileName =  Ti.Utils.md5HexDigest(url);
	this.d('Loading remote image', url, fileName);

	if (this.getFileRecord(fileName)) {
		this.d('Using cached file');
		return this.readFile(fileName);
	}

	this.d("Doesn't have file yet");

	// generate a blob
	var blob = Ti.UI.createImageView({
		image : url,
		width : Ti.UI.SIZE,
		height : Ti.UI.SIZE
	}).toBlob();

	this.saveBlob(fileName, blob);
	return blob;
};

/**
 * This function will fetch the image in the background
 * with a configurable cache period
 * @param {String} url of the image to cache
 * @param {Integer} (Optional) Timeout in milliseconds
 * @param {Function} (Optional) callback function, blob will be returned
 * @param {Function} (Optional) Function to be called upon a error response
 * @param {Function} (Optional) Function to be called at regular intervals as the request data is being received
 */
ImageCache.prototype.loadAsync = function(url, requestTimeout,
	successCallback, errorCallback, datastreamCallback){

	var fileName =  Ti.Utils.md5HexDigest(url);
	if (this.getFileRecord(fileName)) {
		this.d('File already cached', url);
		return false;
	}

	var self = this,
		opts = {
			onload: function() {
				this.saveBlob(fileName, this.responseData);
				successCallback && successCallback(self.readFile(fileName));
			},
			timeout: requestTimeout || 30000
		};

	_.isFunction(errorCallback) && (opts.onerror = errorCallback);
	_.isFunction(datastreamCallback) && (opts.ondatastream = datastreamCallback);

	var xhr = Titanium.Network.createHTTPClient(opts);
	xhr.open('GET', url);
	xhr.send();
	xhr = null;
	opts = null;
	return true;
};

module.exports = ImageCache;
