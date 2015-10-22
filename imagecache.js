function ImageCache(options) {
	if(_.isUndefined(options.cacheKey)) {
		Ti.API.error("You must specify unique persistent `cacheKey` for this cache instance. Warning: existen cache will be owerwrited!");
		return;
	} else {
		this._baseKey = 'com.falkolab.imagecache.'+this.cacheKey;
	}

	var configKey = this._baseKey + '.config';

	var config = _.extend(
		Ti.App.Properties.getObject(configKey, ImageCache.defaultConfig),
			_.pick(options, _.keys(ImageCache.defaultConfig)));

	var silentProps = false;

	Object.defineProperty(this, 'cacheKey', {
		value: config.cacheKey,
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

	Object.defineProperty(this, 'expireTime', {
		get: function() { return config.expireTime;	},
		set: function(value) {
			this.flushExpired();
			config.expireTime = value;
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
	expireTime: 43200, // half a day (in seconds)
	debug: false, // does console.log debug
	remoteBackup: true, // do you want the file(s) to be backed up to a remote cloud, like iCloud on iOS? Doesn't work on Android
	baseDirectory: Titanium.Filesystem.applicationDataDirectory // wher is files stored
};

ImageCache.prototype.d = function() {
	this.debug && Ti.API.debug.apply(null,['ImageCache [' + this.cacheKey + ']:'].concat(arguments));
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
 * Check if file based on filename is already in system
 */
ImageCache.prototype.hasFile = function(filename){
	this.d('Checking file in system:', filename);
	return _.findWhere(this.getFileList(), {filename: filename});
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
 * @param {String} filename (needs to be unique, otherwise will overwrite)
 * @param {Blob} Blob of the image
 */
ImageCache.prototype.saveBlob = function(filename, blob){
	this.d('Save blob', filename);
	if (hasFile(filename))	return;

	this.ensureDir();

	var file = Ti.Filesystem.getFile(this.baseDirectory, this.folder, filename);

	if (file.write(blob)){
		if (Ti.Platform.name == 'iPhone OS'){
			file.remoteBackup = this.remoteBackup;
		}
	}

	file = null;

	var list = this.getFileList();
	list.push({
		filename: filename,
		added: Date.now(),
		fileSize: blob.length,
		expireTime: this.expireTime,
		folder: this.folder
	});

	this.setFileList(list);
	list = null;
};

/**
 * read file from memory
 */
ImageCache.prototype.readFile = function(filename){
	this.d('Reading file', filename);

	var fileRecord = this.hasFile(filename);
	if(!fileRecord) {
		throw "File "+filename+" not found!";
	}


	return Ti.Filesystem.getFile(this.baseDirectory,
		fileRecord.folder, filename).read();
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
	this.d('Completely emtying cache');
	this.removeFiles(_.pluck(this.getFileList(), 'filename'));
};

/**
 * Clear only cache files that are older than cache expiry time
 */
ImageCache.prototype.flushExpired = function(){
	if (c.debug)
		Ti.API.info('TIC - flush expired files');

	var removeFiles = [];
	_.each(fileList, function(file){
		if (Date.now() - (file.added + (file.expireTime * 1000)) > 0){

			if (c.debug)
				Ti.API.info('TIC - found expired file, removing');

			removeFiles.push(file.filename);
		}
	});

	_.each(removeFiles, removeFile);
};

/**
 * Remove a file based on internal filename
 * Note: filename is generated by To.ImageCache
 * @param {String} Filename of the image
 */
ImageCache.prototype.removeFiles = function(){
	this.d('Removing', arguments.length,'files');

	var list = this.getFileList();
	var result = _.chain(arguments).map(function(filename) {
		var fileRecord = this.hasFile(filename);
		if (!fileRecord){
			return null;
		}

		var file = Ti.Filesystem.getFile(this.baseDirectory, fileRecord.folder, fileRecord.filename);

		if (!file.exists()){
			this.d('File ' + filename + ' has aleady been removed');
			return fileRecord;
		}

		if (file.deleteFile()){
			this.d('File ' + filename + ' has been removed');
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
 * Useful if you don't know the filename
 * @param {String} URL of the image
 */
ImageCache.prototype.removeRemote = function(url) {
	this.d('Removing file based on URL', url);
	this.removeFile(Ti.Utils.md5HexDigest(url));
};

/**
 * This function will always return a blob, wether it was cached or not.
 * Therefore, only use this function if you want to cache it.
 * @param {String} url
 */
ImageCache.prototype.loadSync = function(url) {
	var filename =  Ti.Utils.md5HexDigest(url);
	this.d('Loading remote image', url, filename);

	if (this.hasFile(filename)) {
		this.d('Using cached file');
		return this.readFile(filename);
	}

	this.d("Doesn't have file yet");

	// generate a blob
	var blob = Ti.UI.createImageView({
		image : url,
		width : Ti.UI.SIZE,
		height : Ti.UI.SIZE
	}).toBlob();

	this.storeFile(filename, blob);
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

	var filename =  Ti.Utils.md5HexDigest(url);
	if (this.hasFile(filename)) {
		this.d('File already cached', url);
		return false;
	}

	var self = this,
		opts = {
			onload: function() {
				this.storeFile(filename, this.responseData);
				successCallback && successCallback(self.readFile(filename));
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
