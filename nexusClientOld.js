App.factory('$nexus', function(){
	var Nexus;
	var initialized  = false;
	var queue        = [];
	var scopes       = {};
	var actions      = {};
	var ahClient       = new actionheroClient();
	
	/**
	 * Fast UUID generator, RFC4122 version 4 compliant.
	 * @author Jeff Ward (jcward.com).
	 * @license MIT license
	 * @link http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/21963136#21963136
	 **/
	var UUID = (function() {
	  var self = {};
	  var lut = []; for (var i=0; i<256; i++) { lut[i] = (i<16?'0':'')+(i).toString(16); }
	  self.generate = function() {
	    var d0 = Math.random()*0xffffffff|0;
	    var d1 = Math.random()*0xffffffff|0;
	    var d2 = Math.random()*0xffffffff|0;
	    var d3 = Math.random()*0xffffffff|0;
	    return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+'-'+
	      lut[d1&0xff]+lut[d1>>8&0xff]+'-'+lut[d1>>16&0x0f|0x40]+lut[d1>>24&0xff]+'-'+
	      lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+'-'+lut[d2>>16&0xff]+lut[d2>>24&0xff]+
	      lut[d3&0xff]+lut[d3>>8&0xff]+lut[d3>>16&0xff]+lut[d3>>24&0xff];
	  };
	  return self;
	})();
	
	function isEmptyObject(obj) {
		for(var prop in obj) {
			if (Object.prototype.hasOwnProperty.call(obj, prop)) {
				return false;
			}
		}
		return true;
	}
	
	// Resolve all success callbacks given with data.
	function resolve(callbacks, data){
		_.each(callbacks, function(cb){
			cb(data);
		});	
	}
	
	// Reject all error callbacks given with error.
	function reject(callbacks, error){
		_.each(callbacks, function(cb){
			cb(error);
		});
	}
	
	// Validate a queue item
	function validateQueueItem(item){
		
		console.log('Params 4: ', item.params);
		
		// Reject invalid actions
		if(typeof actions[item.action] === 'undefined') {
			reject(item.error, new Error ('Action "' + item.action + '" does not exist.'));
			_.defer(processQueue);
			return false;
		}
		if(typeof actions[item.action][item.version] === 'undefined') {
			reject(item.error, new Error ('Version "' + item.version + '" of action "' + item.action + '" does not exist.'));
			_.defer(processQueue);
			return false;
		}
		if(typeof actions[item.action][item.version].inputs !== 'undefined' && typeof actions[item.action][item.version].inputs.required !== 'undefined') {
			var missingProps = _.difference(actions[item.action][item.version].inputs.required, _.keys(item.params));
			if( missingProps.length != 0 ){
				reject(item.error, new Error ('The following required properties are missing: ' + JSON.stringify(missingProps)));
				_.defer(processQueue);
				return false;
			}
		}
		/*
		if(typeof actions[item.action][item.version].requires !== 'undefined') {
			if(!item.uuid){
				console.warn('Nexus: ','Live Action "' +item.action+ '" is being run without having initialized $nexus. Unexpected behavior WILL occur!');
				item.uuid = UUID.generate();
			}
		}*/
		return true;
	}
	
	// Process actions, to allow for actions that are sent rapidly, or before initialization is complete.
	var processQueue = function(){
		
		// Don't do anything until initialized
		if(!initialized) {return;}
		
		// Validate queue item
		var item = queue.shift();
		console.log('Params 3: ', item.params);
		if(typeof item === 'undefined') {return;}
		if(!validateQueueItem(item)) {
			_.defer(processQueue);
			return;
		}
		
		// If there are additional actions, process them and handle their callbacks as one.
		if(item.additionalActions.length == 0){
			actions[item.action][item.version].run(item.params, item.uuid, item.scope, item.success);
		}else{
			var count = 0;
			var responses = [];
			
			// Process the actions
			_.each(item.additionalActions, function(addItem, position){
				
				console.log(position)
				
				if(validateQueueItem({action: addItem.action, version: addItem.version, uuid: item.uuid, scope: item.scope, params: addItem.params, error: item.error})){
					actions[addItem.action][addItem.version].run(addItem.params, addItem.uuid, addItem.scope, [function(response){
						responses[position+1] = response;
						count++;
						
						console.log(response);
						console.log(count);
						
						if (count > item.additionalActions.length){
							resolve(item.success, responses);
						}
					}]);
				}
			});
			actions[item.action][item.version].run(item.params, item.uuid, item.scope, [function(response){
				responses[0] = response;
				count++;
				
				console.log(response);
				console.log(count);
				
				if (count > item.additionalActions.length){
					resolve(item.success, responses);
				}
			}]);
		}
		
		// Continue processing the queue later.
		_.defer(processQueue);
		
	};
	
	// Take action and parameters and return an object for adding callbacks.
	Nexus = function(action, version, params, uuid, scope){
		console.log('Params 2: ', params);
		// Generate an instance with an ID for Live actions
		if(typeof action !== 'string'){
			
			var constructor = function(){
				var self = {};
				self.UUID = UUID.generate();
				self.scope = action;
				self.action = function(action, version, params){
					console.log('Params 1: ', params);
					return Nexus(action, version, params, this.UUID, this.scope);
				};
				self.destroy = function(){
					console.info('Nexus: ', 'Destroying Nexus instance.')
					
					// Cleanup callbacks
					for(var actionName in actions){
						for(var actionVersion in actions[actionName]){
							for(var paramHash in actions[actionName][actionVersion]['callbacks']){
								if( actions[actionName][actionVersion]['callbacks'][paramHash][this.UUID] ){
									delete actions[actionName][actionVersion]['callbacks'][paramHash][this.UUID];
								}
								if( isEmptyObject(actions[actionName][actionVersion]['callbacks'][paramHash]) ){
									delete actions[actionName][actionVersion]['callbacks'][paramHash];
									delete actions[actionName][actionVersion]['params'][paramHash];
									delete actions[actionName][actionVersion]['data'][paramHash];
								}
								
							}
						}
					}
				};
				
				self.scope.$on("$destroy", function() {
			        self.destroy();
			    });
				
				return self;
			};
			return new constructor();
		}
		
		if(typeof params  === 'undefined') {params  = {};}
		if(typeof version === 'undefined') {version = 1;}
		
		var additionalActions = [];
		var  successCallbacks = [];
		var    errorCallbacks = [];
		
		var cbHandler = {};
		cbHandler.and = function(action, version, params){
			additionalActions.push({action: action, version: version, params: params});
			return cbHandler;
		}
		cbHandler.then = function(callback){
			successCallbacks.push(callback);
			return cbHandler;
		};
		cbHandler.error = function(callback){
			errorCallbacks.push(callback);
			return cbHandler;
		};
		
		queue.push({action: action, version: version, uuid: uuid, scope: scope, params: params, success: successCallbacks, error: errorCallbacks, additionalActions: additionalActions});
		
		if(initialized){
			_.defer(processQueue);
		}
		
		return cbHandler;
	};
	
	// Connect to server
	ahClient.connect(function(err, details){
		console.info('Nexus: ', 'Initialising Nexus Client');
		
		if(err != null){
			console.error('Nexus: ', err);
			return;
		}
		
		ahClient.roomAdd('nexus', function(err){
			if(err != null){
				console.error('Nexus: ', err);
			}else{
				console.info('Nexus: ', 'Client has connected.')
			}
		});
		
		
		// Check for errors while connecting.
		if(err != null){
			console.log(err);
			return;
		}
		
		// Get action documentation
		ahClient.action('showDocumentation', {}, function(response){
			
			// Create methods to access data
			_.each(response.documentation, function(actionVersions, actionName){
				
				// Create methods for each version
				actions[actionName] = {};
				_.each(actionVersions, function(actionMeta, actionVersion){
					
					// Create function that retrieves data.
					actions[actionName][actionVersion] = {};
					actions[actionName][actionVersion].name = actionMeta.name;
					actions[actionName][actionVersion].version = actionMeta.version;
					actions[actionName][actionVersion].description = actionMeta.description;
					actions[actionName][actionVersion].inputs = actionMeta.inputs;
					actions[actionName][actionVersion].requires = actionMeta.requires;
					actions[actionName][actionVersion].run = function(params, uuid, scope, callbacks){
						console.log('Params 5: ', params);
						
						// Ensure that apiVersion is set correctly as a param.
						params.apiVersion = actionVersion;
						
						console.log('Params 6: ', params);
						
						// Add data for live actions
						if(
							typeof actions[actionName][actionVersion].requires !== 'undefined' &&
							typeof uuid !== 'undefined' &&
							typeof scope !== 'undefined'
						){
						
							// Hash the params for storing data.
							var paramHash = _.reduce(params, function(c, v, k){return c+k+v;}, '##');
							
							// Store the params
							if(typeof actions[actionName][actionVersion]['params'] === 'undefined'){
								actions[actionName][actionVersion]['params'] = {};
							}
							if(typeof actions[actionName][actionVersion]['params'][paramHash] === 'undefined'){
								actions[actionName][actionVersion]['params'][paramHash] = params;
							}
							
							// Store the callbacks
							if(typeof actions[actionName][actionVersion]['callbacks'] === 'undefined'){
								actions[actionName][actionVersion]['callbacks'] = {};
							}
							if(typeof actions[actionName][actionVersion]['callbacks'][paramHash] === 'undefined'){
								actions[actionName][actionVersion]['callbacks'][paramHash] = {};
							}
							if(typeof actions[actionName][actionVersion]['callbacks'][paramHash][uuid] === 'undefined'){
								actions[actionName][actionVersion]['callbacks'][paramHash][uuid] = callbacks;
							}
							
							// Store the scopes
							if(typeof scopes[uuid] === 'undefined'){
								scopes[uuid] = scope;
							}
							
							// Check for cached data and respond
							if(
								typeof actions[actionName][actionVersion]['data'] !== 'undefined' &&
								typeof actions[actionName][actionVersion]['data'][paramHash] !== 'undefined'
							){
								resolve(callbacks, actions[actionName][actionVersion]['data'][paramHash]);
							} else {
								ahClient.action(actionName, params, function(response){
									
									// Cache the response.
									if(typeof actions[actionName][actionVersion].data === 'undefined') actions[actionName][actionVersion]['data'] = {};
									actions[actionName][actionVersion]['data'][paramHash] = response;
									
									// Pass the response to all of the callbacks.
									scope.$apply(function(){
										resolve(callbacks, response);
									});
								});
							}
						}else{ // Call the correct version of the action
							console.log('params sent to server: ', JSON.stringify(params));
							console.log('Params 7: ', params);
							ahClient.action(actionName, params, function(response){
								console.log('Params 8: ', params);
								// Pass the response to all of the callbacks.
								if(typeof scope !== 'undefined'){
									scope.$apply(function(){
										resolve(callbacks, response);
									});
								}else{
									resolve(callbacks, response);
								}
								
							});
						}
					};
				});
			});
			
			// Mark service as innitialized and start processing requests.
			console.info('Nexus: ', 'Client has completed initialization.')
			initialized = true;
			_.defer(processQueue);
		});
	});
	
	// handle updating data
	ahClient.on('message', function(message){
		//console.log('Message: ', message);
		
		// If message is about changing data, then find and update all effected data.
		if( message.message && message.message.type == 'dataChange' ){
			_.each(actions, function( actionVersions, actionName ){
				_.each(actionVersions, function( actionMeta, actionVersion ){
					
					// Retrieve the updated data for affected actions.
					if(
						typeof actionMeta.requires !== 'undefined' &&
						_.intersection( message.message.effected, actionMeta.requires ).length > 0
					){
						// Loop over the parameters
						_.each(actionMeta['params'], function( params, paramHash ){
							
							// Fetch the data
							ahClient.action( actionName, params, function(response){
								
								// Cache the response.
								if( typeof actionMeta.data === 'undefined' ) {
									actionMeta['data'] = {};
								}
								actionMeta['data'][paramHash] = response;
								
								// Loop over all of the instance id's and send out their callbacks.
								_.each( actionMeta['callbacks'][paramHash], function(callbacks, uuid ){
									
									// Pass the response to all of the callbacks for this instance.
									if(typeof scopes[uuid] !== 'undefined'){
										scopes[uuid].$apply(function(){
											resolve(callbacks, response);
										});
									}else{
										resolve(callbacks, response);
									}
								});
							});
						});
					}
				});
			});
		}
		
	});
	
	return Nexus;
});
