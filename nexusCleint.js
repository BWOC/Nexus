//////////////////////////////////////////////////
// Nexus - An Angular client for Actionhero     //
// (c) 2015 Believers World Outreach Church     //
// See LICENSE file for more information.       //
//////////////////////////////////////////////////
App.factory('$nexus', function(){
	var ahClient    = new actionheroClient();
	var initialized = false;
	var queue       = [];
	var actions     = {};
	var paramsCache = {};
	var scopes      = {};
	
	
	//////////////////////////////////////////////////
	// Initialization
	//////////////////////////////////////////////////
	console.info('Nexus: ', 'Initialising Nexus Client');
	ahClient.connect(function(err, details){
		if(err != null){
			console.error('Nexus: ', err);
			return;
		}else{
			console.info('Nexus: ', 'Client has connected.');
		}
		
		console.info('Nexus: ', 'Connecting to room: "nexus"');
		ahClient.roomAdd('nexus', function(response){
			if(response.status != 'OK'){
				console.error('Nexus: ', response);
				return;
			}else{
				console.info('Nexus: ', 'Client has entered the room: "nexus"');
			}
			
			console.info('Nexus: ', 'Retrieving API Documentation.');
			ahClient.action('showDocumentation', {}, function(response){
				if(typeof response.documentation === 'undefined'){
					console.error('Nexus: ', response);
					return;
				}else{
					console.info('Nexus: ', 'Parsing API Documentation.');
				}
				
				// Loop over the response to parse the documents into API functions.
				_.each(response.documentation, function(actionVersions, actionName){
					
					actions[actionName] = {};
					_.each(actionVersions, function(actionMeta, actionVersion){
						
						// Create function that retrieves data.
						actions[actionName][actionVersion] = new actionDefinition(actionMeta.name, actionMeta.version, actionMeta.description, actionMeta.inputs, actionMeta.requires);
					});
				});
				
				initialized = true;
				_.defer(processQueue);
			});
		});
	});
	
	
	
	
	//////////////////////////////////////////////////
	// Main functions
	//////////////////////////////////////////////////
	
	//////////////////////////////////////////////////
	// Main Function
	//  Returns a new instance of nexusClient, because you don't new a service.
	var Nexus = function(scope){
		return new nexusClient(scope);
	};
	
	
	//////////////////////////////////////////////////
	// nexusClient Constructer
	//  Takes a $scope and handles everything.
	function nexusClient(scope){
		console.info('Nexus: ', 'Creating new scope: ', scope.$id);
		var self = this;
		self.id = scope.$id;
		self.scope = scope;
		scopes[self.id] = self.scope;
		
		// Create an actionBuilder and initialize it with the first action.
		self.action = function(action, version, params){
			return new actionBuilder(action, version, params, self.scope);
		};
	}
	
	
	//////////////////////////////////////////////////
	// actionBuilder Constructer
	//  Builds an action to be sent to ahClient
	function actionBuilder(action, version, params, scope){
		var self = this;
		self.scope = scope;
		
		var successCallbacks  = [];
		var failureCallbacks  = [];
		
		// Allow adding additional actions that use the same callbacks
		self.addAction = function(action, version, params){
			console.info('Nexus: ', 'Adding new action: ', action, version, params);
			queue.push({name: action, version: version, params: params, scope: self.scope, callback: successCallbacks});
			return self;
		};
		self.and = self.addAction;
		
		// Add a success callback
		self.success = function(callback){
			successCallbacks.push(callback);
			return self;
		};
		self.then = self.success;
		
		// Add a failure callback
		self.failure = function(callback){
			failureCallbacks.push(callback);
			return self;
		};
		self.error = self.failure;
		
		// Add the first action.
		self.addAction(action, version, params);
		
		// Process the queue on the next tick.
		_.defer(processQueue);
	}
	
	
	//////////////////////////////////////////////////
	// actionDefinition constructer
	//  Constructs a new actionDefinition object, to manage the actions.
	function actionDefinition(name, version, desc, inputs, requires){
		var self     = this;
		self.name    = name;
		self.version = version;
		self.desc    = desc;
		self.inputs  = inputs;
		
		// Check if the action supports live data
		if(typeof requires !== 'undefined'){
			self.requires  = requires;
			self.data      = {};
			self.callbacks = {};
		}
		
		// Handles sending an action to the server and the response.
		self.run = function(params, scope, callbacks){
			
			// Check if the action supports live data
			if(typeof self.requires !== 'undefined'){
				
				// Store the params and get an ID for them.
				var paramsId = getObjectIndex(paramsCache, params);
				
				// Store the callbacks
				if(typeof self.callbacks[paramsId] === 'undefined'){
					self.callbacks[paramsId] = {};
				}
				if(typeof self.callbacks[paramsId][scope.$id] === 'undefined'){
					self.callbacks[paramsId][scope.$id] = [];
				}
				self.callbacks[paramsId][scope.$id].concat(callbacks);
				
				// Return the data
				if(typeof self.data[paramsId] !== 'undefined'){
					scope.$apply(function(){
						returnCallback(self.callbacks[paramsId][scope.$id], self.data[paramsId]);
					});
				}else{
					runAction(self.name, self.version, params, function(response){
						
						if(typeof response.error == 'undefined'){
							self.data[paramsId] = response;
						}
						
						// Send out the callbacks
						scope.$apply(function(){
							returnCallback(self.callbacks[paramsId][scope.$id], response);
						});
					});
				}
			}else{
				runAction(self.name, self.version, params, function(response){
					// Send out the callbacks
					
					console.log(self);
					
					scope.$apply(function(){
						returnCallback(callbacks, response);
					});
				});
			}
		};
	}
	
	
	//////////////////////////////////////////////////
	// Helpers
	//////////////////////////////////////////////////
	
	// Process the queue.
	var processQueue = function processQueue(){
		
		// Ensure that Nexushas been initialized before prosessing the queue. 
		console.info('Nexus: ', 'Processing queue');
		if(!initialized) return;
		
		// Shift an action off of the queue and validate it
		var action = queue.shift();
		if(typeof action === 'undefined') return;
		
		console.info('Nexus: ', 'Processing action', action.name);
		
		if(action.name in actions && action.version in actions[action.name])
		actions[action.name][action.version].run(action.params, action.scope, action.callback);
		
		//runAction(action.action, action.version, action.params, action.callback);
			
		_.defer(processQueue);
	};
	
	// Run an action and return the results
	var runAction = function runAction(action, version, params, callback){
		
		// Assign the version to the action.
		params.apiVersion = version;
		
		// Run the action.
		ahClient.action(action, params, callback);
	};
	
	// Respond to a series of callbacks
	var returnCallback = function returnCallback(callbacks, response){
		_.each(callbacks, function(cb){
			cb(response);
		});
	};
	
	// Return the index of an object in an array, adding it if not found.
	var getObjectIndex = function findObjectInArray(array, object){
		
		// Get a list of all the keys in the object being searched for.
		var objectKeys = _.keys(object);
		
		// Loop through the array to find an equal object
		for(var x in array){
			
			// Check if the objects have exactly the same keys
			if(_.xor(objectKeys, _.keys(array[x])).length == 0){
				
				// Loop over the keys and check that they are all equal
				var match = true;
				for(var key in object){
					if(object[key] !== array[x][key]) {
						match = false;
						break;
					}
				}
				if(match){ return x; }
			}
		}
		return array.push(object);
	};
	
	return Nexus;
});
