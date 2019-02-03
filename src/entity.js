import * as util from "./util.js";


export class Entity extends PIXI.utils.EventEmitter {
  constructor() {
    super();

    this.isSetup = false;
    this.eventListeners = [];
  }

  // @config includes narrator
  setup(config) {
    if(this.isSetup) {
      console.error("setup() called twice", this);
      console.trace();
    }    

    this.config = config;
    this.isSetup = true;
  }

  // options include { playTime, timeSinceStart, timeScale, gameState }
  update(options) {
    if(!this.isSetup) {
      console.error("update() called before setup()", this);
      console.trace();
    }
  }

  teardown() {
    if(!this.isSetup) {
      console.error("teardown() called before setup()", this);
      console.trace();
    }

    this._off(); // Remove all event listeners

    this.config = null;
    this.isSetup = false;
  }

  // Optionally returns either a truthy value, or possibly an object containing the keys { name, params}
  // @options are the same as for update()
  requestedTransition(options) { 
    if(!this.isSetup) {
      console.error("requestedTransition() called before setup()", this);
      console.trace();
    }

    return null; 
  } 

  // @signal is string, @data is whatever
  onSignal(signal, data = null) { 
    if(!this.config) 
      console.error("onSignal() called before setup()", this);
  }

  _on(emitter, event, cb) {
    this.eventListeners.push({ emitter, event, cb });
    emitter.on(event, cb, this);
  }

  // if @cb is null, will remove all event listeners for the given emitter and event
  _off(emitter = null, event = null, cb = null) {
    const props = {};
    if(emitter) props.emitter = emitter;
    if(event) props.event = event;
    if(cb) props.cb = cb;

    _.each(_.filter(this.eventListeners, props), listener => listener.emitter.off(listener.event, listener.cb));
    this.eventListeners = _.reject(this.eventListeners, _.matcher(props));
  }
}

export class StateMachine extends Entity {
  /**
      A transition is defined as either a name (string) or { name, params } 
      @states: an object of names to Entity, or to function(params): Entity
      @transitions: an object of names to transition, or to function(name, params, previousName, previousParams): Transition
  */
  constructor(states, transitions, options) {
    super();

    this.states = states;
    this.transitions = transitions;

    util.setupOptions(this, options, {
      startingState: "start", 
      startingStateParams: {},
      endingState: "end",
    });
  }

  setup(config) {
    super.setup(config);

    this.container = new PIXI.Container();;

    this.endingStateReached = null;
    
    this._changeState(0, this.startingState, this.startingStateParams);

    return this.container; 
  }

  update(options) {
    super.update(options);

    if(!this.state) return;

    const timeSinceStateStart = options.timeSinceStart - this.sceneStartedAt;
    const stateOptions = _.extend({}, options, { timeSinceStart: timeSinceStateStart });
    this.state.update(stateOptions);

    const requestedTransition = this.state.requestedTransition(stateOptions);
    if(requestedTransition) {
      // Unpack requested transition
      let requestedTransitionName, requestedTransitionParams;
      if(_.isObject(requestedTransition)) {
        requestedTransitionName = requestedTransition.name;
        requestedTransitionParams = requestedTransition.params;
      } else {
        requestedTransitionName = requestedTransition;
      }

      // Follow the transition
      if(!(this.stateName in this.transitions)) {
        throw new Error(`Cannot find transition for state '${this.stateName}'`);
      }

      const transitionDescriptor = this.transitions[this.stateName];
      let nextStateDescriptor;
      if(_.isFunction(transitionDescriptor)) {
        nextStateDescriptor = transitionDescriptor(requestedTransitionName, requestedTransitionParams, this.stateName, this.stateParams);
      } else if(_.isString(transitionDescriptor)) {
        nextStateDescriptor = transitionDescriptor;
      } else {
        throw new Error(`Cannot decode transition descriptor '${JSON.stringify(transitionDescriptor)}'`);
      }

      // Unpack the next state
      let nextStateName, nextStateParams;
      if(_.isObject(nextStateDescriptor) && _.isString(nextStateDescriptor.name)) {
        nextStateName = nextStateDescriptor.name;
        nextStateParams = nextStateDescriptor.params;
      } else if(_.isString(nextStateDescriptor)) {
        nextStateName = nextStateDescriptor;
        nextStateParams = requestedTransition.params; // By default, pass through the params in the requested transition
      } else {
        throw new Error(`Cannot decode state descriptor '${JSON.stringify(nextStateDescriptor)}'`);
      }
      
      this._changeState(options.timeSinceStart, nextStateName, nextStateParams)
    }
  }

  teardown() { 
    super.teardown();

    if(this.state) {
      this.state.teardown(); 
      this.state = null;
      this.stateName = null;
    }
  }

  requestedTransition(options) { 
    super.requestedTransition(options);

    return this.endingStateReached; 
  }

  onSignal(signal, data = null) { 
    super.onSignal(signal, data);

    if(this.state) this.state.onSignal(signal, data);
  }

  _changeState(timeSinceStart, nextStateName, nextStateParams) {
    // If reached ending state, stop here. Teardown can happen later
    if(nextStateName == this.endingState) {
      this.endingStateReached = nextStateName;
      return;
    }


    if(this.state) {
      this.state.teardown();
      this.container.removeChildren();
    }

    if(nextStateName in this.states) {
      const nextStateDescriptor = this.states[nextStateName];
      if(_.isFunction(nextStateDescriptor)) {
        this.state = nextStateDescriptor(nextStateParams);
      } else {
        this.state = nextStateDescriptor;
      }

      const stateContainer = this.state.setup(this.config);
      if(stateContainer) this.container.addChild(stateContainer);
    } else {
      throw new Error(`Cannot find state '${nextStateName}`);
    }

    this.sceneStartedAt = timeSinceStart;

    const previousStateName = this.stateName;
    const previousStateParams = this.stateParams;
    this.stateName = nextStateName;
    this.stateParams = nextStateParams;

    this.emit("stateChange", nextStateName, nextStateParams, previousStateName, previousStateParams);
  }
}

export function makeTransitionTable(table) {
  const f = function(requestedTransitionName, requestedTransitionParams, previousStateName, previousStateParams) {
    if(requestedTransitionName in table) {
      const transitionDescriptor = table[requestedTransitionName];
      if(_.isFunction(transitionDescriptor)) {
        return transitionDescriptor(requestedTransitionName, requestedTransitionParams, previousStateName, previousStateParams);
      } else {
        return transitionDescriptor;
      }
    } else {
      throw new Error(`Cannot find state ${nextStateName}`);
    }
  }
  f.table = table; // For debugging purposes

  return f;
}


export class CompositeEntity extends Entity {
  constructor(entities = []) {
    super();
    this.entities = entities;
  }

  setup(config) {
    super.setup(config);

    // OPT: for performance, we don't need a container if the children don't display anything
    this.container = new PIXI.Container();

    for(const entity of this.entities) {
      if(!entity.isSetup) {
        const childDisplay = entity.setup(config);
        if(childDisplay) this.container.addChild(childDisplay);
      }
    } 

    return this.container;
  }

  update(options) {
    super.update(options);

    for(const entity of this.entities) {
      entity.update(options);
    }
  } 

  // Returns the answer of the first entity
  requestedTransition(options) { 
    super.requestedTransition(options);

    if(this.entities.length) return this.entities[0].requestedTransition(options);
    return null;
  }

  teardown() {
    super.teardown();

    for(const entity of this.entities) {
      entity.teardown();
    }
  }

  onSignal(signal, data) { 
    super.onSignal(signal, data);

    for(const entity of this.entities) {
      entity.onSignal(signal, data);
    }
  }

  addEntity(entity) {
    // If we have already been setup, setup this new entity
    if(this.isSetup && !entity.isSetup) {
      const childDisplay = entity.setup(this.config);
      if(childDisplay) this.container.addChild(childDisplay);
    }

    this.entities.push(entity);
  }

  removeEntity(entity) {
    const index = this.entities.indexOf(entity);
    if(index === -1) throw new Error("Cannot find entity to remove");

    if(entity.isSetup) {
      entity.teardown();

      if(entity.container) {
        this.container.removeChild(entity.container);
      }
    }

    this.entities.splice(index, 1);
  }
}

// An entity that executes one scene after the other
export class EntitySequence extends Entity {
  // @options includes loop (default: false)
  constructor(entities, options = {}) {
    super();

    this.entities = entities;
    this.loop = options.loop || false;
  }

  // Does not setup entity
  addEntity(entity) {
    if(this.lastRequestedTransition) return;

    this.entities.push(entity); 
  }

  skip() {
    if(this.lastRequestedTransition) return;

    this._advance({ name: "skip" });
  }

  setup(config) {
    super.setup(config);

    this.currentEntityIndex = 0;
    this.lastRequestedTransition = null;

    this.container = new PIXI.Container();
    this._activateEntity(0);
    return this.container;
  }

  update(options) {
    super.update(options);

    if(this.lastRequestedTransition) return;


    const timeSinceChildStart = options.timeSinceStart - this.childStartedAt;
    const childOptions = _.extend({}, options, { timeSinceStart: timeSinceChildStart });

    this.lastUpdateOptions = options;

    if(this.currentEntityIndex >= this.entities.length) return;

    this.entities[this.currentEntityIndex].update(childOptions);

    const transition = this.entities[this.currentEntityIndex].requestedTransition(childOptions);
    if(transition) this._advance(transition);
  } 

  requestedTransition(options) { 
    super.requestedTransition(options);

    return this.lastRequestedTransition;
  }

  teardown() {
    super.teardown();

    if(this.lastRequestedTransition) return;


    this._deactivateEntity();
  }

  onSignal(signal, data) { 
    if(this.lastRequestedTransition) return;

    this.entities[this.currentEntityIndex].onSignal(signal, data);
  }

  restart() {
    this.currentEntityIndex = 0;
    this.lastRequestedTransition = false;

    this._deactivateEntity();
    this._activateEntity(0);
  }

  _activateEntity(time) {
    const childDisplay = this.entities[this.currentEntityIndex].setup(this.config);
    if(childDisplay) this.container.addChild(childDisplay);
    this.childStartedAt = time;
  }

  _deactivateEntity() {
    this.entities[this.currentEntityIndex].teardown();
    this.container.removeChildren();
  }

  _advance(transition) {
    if(this.currentEntityIndex < this.entities.length - 1) {
      this._deactivateEntity();
      this.currentEntityIndex = this.currentEntityIndex + 1;
      this._activateEntity(this.lastUpdateOptions.timeSinceStart);
    } else if(this.loop) {
      this._deactivateEntity();
      this.currentEntityIndex = 0;
      this._activateEntity(this.lastUpdateOptions.timeSinceStart);
    } else {
      this._deactivateEntity();
      this.lastRequestedTransition = transition;
    }
  }
}

// An entity that takes functions in the constructor
export class FunctionalEntity extends CompositeEntity {
  // @functions is an object, with keys: setup, update, teardown, requestedTransition, onSignal
  constructor(functions, childEntities = []) {
    super();

    this.functions = functions;

    for(let childEntity of childEntities) this.addEntity(childEntity);
  }

  setup(config) {
    super.setup(config);

    if(this.functions.setup) this.functions.setup(config, this);
  }

  update(options) {
    super.update(options);

    if(this.functions.update) this.functions.update(options, this);
  }

  teardown() {
    super.teardown();

    if(this.functions.teardown) this.functions.teardown(this);
  }

  requestedTransition(options) {
    if(this.functions.requestedTransition) return this.functions.requestedTransition(options, this);

    return null;
  } 

  onSignal(signal, data = null) {
    super.onSignal(signal, data);

    if(this.functions.onSignal) this.functions.onSignal(signal, data);
  }
}

// Waits until time is up, then requests transition
export class WaitingEntity extends Entity {
  constructor(wait) {
    super();

    this.wait = wait;
  }

  requestedTransition(options) {
    super.requestedTransition(options);

    return options.timeSinceStart >= this.wait ? "next" : null;
  }
}

export class VideoEntity extends Entity {
  constructor(videoName, options = {}) {
    super();

    this.videoName = videoName;  
    util.setupOptions(this, options, {
      loop: false,
    });
  }

  setup(config) {
    super.setup(config);

    this.videoElement = this.config.app.loader.resources[this.videoName].data;
    this.videoElement.loop = this.loop;
    this.videoElement.currentTime = 0;
    this.videoElement.play();

    const texture = PIXI.VideoBaseTexture.fromVideo(this.videoElement);
    this.videoSprite = PIXI.Sprite.from(texture);

    return this.videoSprite;
  }

  onSignal(signal, data) {
    super.onSignal(signal, data);

    if(signal === "pause") {
      this.videoElement.pause();
    } else if(signal === "play") {
      this.videoElement.play();
    }
  }

  requestedTransition(options) {
    super.requestedTransition(options);

    return this.videoElement.ended;
  }

  teardown() {
    this.videoElement.pause();

    super.teardown();
  }
}

export class ToggleSwitch extends Entity {
  constructor(onTexture, offTexture, isOn = true) {
    super();

    this.onTexture = onTexture;
    this.offTexture = offTexture;
    this.isOn = isOn;
  }

  setup(options) {
    super.setup(options);

    this.container = new PIXI.Container();

    this.spriteOn = new PIXI.Sprite(this.onTexture);
    this.spriteOn.interactive = true;
    this._on(this.spriteOn, "pointertap", this._turnOff);
    this.container.addChild(this.spriteOn);

    this.spriteOff = new PIXI.Sprite(this.offTexture);
    this.spriteOff.interactive = true;
    this._on(this.spriteOff, "pointertap", this._turnOn);
    this.container.addChild(this.spriteOff);

    this._updateVisibility();

    return this.container;
  }

  setIsOn(isOn, silent = false) {
    this.isOn = isOn;
    _updateVisibility();

    if(!silent) this.emit("change", this.isOn);
  }

  _turnOff() {
    this.isOn = false;
    this._updateVisibility();
    this.emit("change", this.isOn);
  }

  _turnOn() {
    this.isOn = true;
    this._updateVisibility();
    this.emit("change", this.isOn);
  }

  _updateVisibility() {
    this.spriteOn.visible = this.isOn;
    this.spriteOff.visible = !this.isOn;
  }
}

export class AnimatedSpriteEntity extends Entity {
  constructor(animatedSprite) {
    super();

    this.animatedSprite = animatedSprite;
  }

  onSignal(signal, data = null) {
    if(signal == "pause") this.animatedSprite.stop();
    else if(signal == "play") this.animatedSprite.play();
  }
}

export class SkipButton extends Entity {
  setup(config) {
    super.setup(config);

    this.isDone = false;

    const sprite = new PIXI.Sprite(this.config.app.loader.resources["booyah/images/button-skip.png"].texture);
    sprite.anchor.set(0.5);
    sprite.position.set(this.config.app.screen.width - 50, this.config.app.screen.height - 50);
    sprite.interactive = true;
    this._on(sprite, "pointertap", this._onSkip);
    
    return sprite;
  }

  requestedTransition(options) {
    super.requestedTransition(options);

    return this.isDone;
  }

  _onSkip() {
    this.isDone = true;
    this.emit("skip");
  }
}

export class DeflatingCompositeEntity extends Entity {
  /** Options include:
        autoTransition: If true, requests transition when the entity has no children (default true)
        cleanUpChildren: If true, children that request a transition are automatically removed
  */
  constructor(entities = [], options = {}) {
    super();

    util.setupOptions(this, options, {
      autoTransition: true,
      cleanUpChildren: true,
    });

    this.entities = entities;
  }

  setup(config) {
    super.setup(config);

    // OPT: for performance, we don't need a container if the children don't display anything
    this.container = new PIXI.Container();

    for(const entity of this.entities) {
      if(!entity.isSetup) {
        const childDisplay = entity.setup(config);
        if(childDisplay) this.container.addChild(childDisplay);
      }
    } 

    return this.container;
  }

  update(options) {
    super.update(options);

    // Slightly complicated for-loop so that we can remove entities that are complete
    for(let i = 0; i < this.entities.length; ) {
      const entity = this.entities[i];
      entity.update(options);

      if(this.cleanUpChildren && entity.requestedTransition(options)) {
        console.debug("Cleanup up child entity", entity);
        
        if(entity.isSetup) {
          entity.teardown();

          if(entity.container) {
            this.container.removeChild(entity.container);
          }
        }

        this.entities.splice(i, 1);
      } else {
        i++;
      }
    }
  } 

  // Returns the answer of the first entity
  requestedTransition(options) { 
    super.requestedTransition(options);

    if(this.autoTransition && this.entities.length == 0) return true;
    return null;
  }

  teardown() {
    super.teardown();

    for(const entity of this.entities) {
      entity.teardown();
    }
  }

  onSignal(signal, data) { 
    super.onSignal(signal, data);

    for(const entity of this.entities) {
      entity.onSignal(signal, data);
    }
  }

  addEntity(entity) {
    // If we have already been setup, setup this new entity
    if(this.isSetup && !entity.isSetup) {
      const childDisplay = entity.setup(this.config);
      if(childDisplay) this.container.addChild(childDisplay);
    }

    this.entities.push(entity);
  }

  removeEntity(entity) {
    const index = this.entities.indexOf(entity);
    if(index === -1) throw new Error("Cannot find entity to remove");

    if(entity.isSetup) {
      entity.teardown();

      if(entity.container) {
        this.container.removeChild(entity.container);
      }
    }

    this.entities.splice(index, 1);
  }
}

