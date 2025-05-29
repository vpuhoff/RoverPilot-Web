class PlatformController {
    constructor(config = {}) {
        this.config = {
            MAX_THROTTLE: 100,
            MAX_STEERING: 100,
            THROTTLE_ACCELERATION: 5,
            THROTTLE_DECELERATION_NATURAL: 2,
            BRAKE_POWER: 6,
            STEERING_SPEED: 9,
            STEERING_RETURN_SPEED: 7,
            UPDATE_INTERVAL_MS: 50,
            ...config.controlParams // Allow overriding control parameters
        };

        this.apiClientConfig = {
            baseUrl: config.baseUrl || '',
        };

        // Internal State
        this.throttle = 0;
        this.steering = 0;
        this.handbrakeOn = false;
        this.keysPressed = {};
        this.conceptualLeft = 0;
        this.conceptualRight = 0;

        // Communication State
        this.lastSentData = null;
        this.lastError = null;

        // Callbacks
        this._onUpdateCallback = config.onUpdate || function() {}; // Called with comprehensive state
        
        this._updateIntervalId = null;
    }

    // --- Private API Client Methods (simplified from previous client) ---
    async _request(endpoint, options = {}) {
        const url = this.apiClientConfig.baseUrl + endpoint;
        try {
            const response = await fetch(url, options);
            let responseData;
            try {
                responseData = await response.json();
            } catch (e) {
                if (!response.ok) {
                    throw { message: `HTTP error ${response.status}: ${response.statusText || 'Non-JSON error body.'}`, status: response.status, details: null };
                }
                throw { message: 'Non-JSON response when JSON expected.', status: response.status, details: null };
            }

            if (!response.ok) {
                throw { message: `Server error: ${responseData.message || 'Unknown server error'}`, status: response.status, details: responseData };
            }
            if (responseData.status && responseData.status === 'error') { // ESP32 /drive specific error with HTTP 200
                 throw { message: `Application error: ${responseData.message || 'Unknown app error'}`, status: 200, details: responseData, isAppError: true };
            }
            return responseData;
        } catch (error) {
            if (error.status !== undefined) throw error; // Re-throw our structured errors
            throw { message: `Network request failed: ${error.message}`, details: error, isNetworkError: true };
        }
    }

    async _sendDriveCommandInternal(left, right) {
        const l = Math.round(left);
        const r = Math.round(right);
        const endpoint = `/drive?left=${l}&right=${r}`;
        return this._request(endpoint, { method: 'GET' });
    }

    // --- Control Logic Methods ---
    _updateSteering() {
        const keyA = 'a';
        const keyD = 'd';
        const keyArrowLeft = 'arrowleft';
        const keyArrowRight = 'arrowright';

        if (this.keysPressed[keyA] || this.keysPressed[keyArrowLeft]) {
            this.steering -= this.config.STEERING_SPEED;
        } else if (this.keysPressed[keyD] || this.keysPressed[keyArrowRight]) {
            this.steering += this.config.STEERING_SPEED;
        } else {
            if (this.steering > this.config.STEERING_RETURN_SPEED) {
                this.steering -= this.config.STEERING_RETURN_SPEED;
            } else if (this.steering < -this.config.STEERING_RETURN_SPEED) {
                this.steering += this.config.STEERING_RETURN_SPEED;
            } else {
                this.steering = 0;
            }
        }
        this.steering = Math.max(-this.config.MAX_STEERING, Math.min(this.config.MAX_STEERING, this.steering));
    }

    _updateThrottle() {
        if (this.handbrakeOn) {
            this.throttle = 0;
            return;
        }

        const keyW = 'w';
        const keyS = 's';
        const keyArrowUp = 'arrowup';
        const keyArrowDown = 'arrowdown';

        if (this.keysPressed[keyW] || this.keysPressed[keyArrowUp]) {
            this.throttle += this.config.THROTTLE_ACCELERATION;
        } else if (this.keysPressed[keyS] || this.keysPressed[keyArrowDown]) {
            this.throttle -= this.config.BRAKE_POWER;
        } else {
            if (this.throttle > this.config.THROTTLE_DECELERATION_NATURAL) {
                this.throttle -= this.config.THROTTLE_DECELERATION_NATURAL;
            } else if (this.throttle < -this.config.THROTTLE_DECELERATION_NATURAL) {
                this.throttle += this.config.THROTTLE_DECELERATION_NATURAL;
            } else {
                this.throttle = 0;
            }
        }
        this.throttle = Math.max(-this.config.MAX_THROTTLE, Math.min(this.config.MAX_THROTTLE, this.throttle));
    }

    _mixToMotorSpeeds() {
        let baseSpeed = this.throttle;
        let steeringAdjustment = this.steering;

        this.conceptualLeft = baseSpeed + steeringAdjustment;
        this.conceptualRight = baseSpeed - steeringAdjustment;

        this.conceptualLeft = Math.max(-this.config.MAX_THROTTLE, Math.min(this.config.MAX_THROTTLE, this.conceptualLeft));
        this.conceptualRight = Math.max(-this.config.MAX_THROTTLE, Math.min(this.config.MAX_THROTTLE, this.conceptualRight));
    }

    async _controlLoop() {
        this._updateSteering();
        this._updateThrottle();
        this._mixToMotorSpeeds();

        try {
            this.lastSentData = await this._sendDriveCommandInternal(this.conceptualLeft, this.conceptualRight);
            this.lastError = null;
        } catch (error) {
            this.lastError = error;
            // Decide if lastSentData should be nulled or kept from previous success
            // For now, null it on error to indicate current send failed
            this.lastSentData = null;
        }
        
        this._notifyUpdate();
    }
    
    _notifyUpdate() {
         if (this._onUpdateCallback) {
            this._onUpdateCallback({
                throttle: this.throttle,
                steering: this.steering,
                conceptualLeft: this.conceptualLeft,
                conceptualRight: this.conceptualRight,
                handbrakeOn: this.handbrakeOn,
                keysPressed: { ...this.keysPressed }, // Send a shallow copy
                lastSentData: this.lastSentData,
                lastError: this.lastError,
            });
        }
    }

    // --- Public Methods ---
    setBaseUrl(baseUrl) {
        this.apiClientConfig.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    pressKey(key) {
        const lowerKey = key.toLowerCase();
        this.keysPressed[lowerKey] = true;
        if(lowerKey === 'q') { // Q is special, it toggles handbrake directly
            this.toggleHandbrake(); // Toggling handbrake might trigger an immediate UI update.
        }
        // For other keys, the effect will be seen in the next _controlLoop tick
        // However, we can optionally call _notifyUpdate for immediate key display feedback
        // This might be too frequent if control loop is fast.
        // For now, key display updates via the main loop's _notifyUpdate.
    }

    releaseKey(key) {
        delete this.keysPressed[key.toLowerCase()];
    }

    toggleHandbrake() {
        this.handbrakeOn = !this.handbrakeOn;
        if (this.handbrakeOn) {
            this.throttle = 0; // Immediate effect on throttle
        }
        // Notify UI of handbrake and potentially throttle change immediately
        this._notifyUpdate();
    }

    start() {
        if (this._updateIntervalId) {
            this.stop();
        }
        this._updateIntervalId = setInterval(() => this._controlLoop(), this.config.UPDATE_INTERVAL_MS);
        console.log("PlatformController started.");
    }

    stop() {
        if (this._updateIntervalId) {
            clearInterval(this._updateIntervalId);
            this._updateIntervalId = null;
            console.log("PlatformController stopped.");
        }
    }

    // For direct/manual control, bypassing the loop. Use with caution if loop is running.
    async manualDrive(left, right) {
        try {
            this.lastSentData = await this._sendDriveCommandInternal(left, right);
            this.lastError = null;
            this._notifyUpdate(); // Notify with the manually sent data
            return this.lastSentData;
        } catch (error) {
            this.lastError = error;
            this.lastSentData = null;
            this._notifyUpdate();
            throw error;
        }
    }
    
    // To get current status from ESP32 /status endpoint
    async getESPStatus() {
        try {
            return await this._request(`/status`, { method: 'GET' });
        } catch (error) {
            console.error("Failed to get ESP status:", error);
            throw error;
        }
    }
    
    getCurrentState() { // Exposes the current client-side state
        return {
            throttle: this.throttle,
            steering: this.steering,
            conceptualLeft: this.conceptualLeft,
            conceptualRight: this.conceptualRight,
            handbrakeOn: this.handbrakeOn,
            keysPressed: { ...this.keysPressed },
            lastSentData: this.lastSentData,
            lastError: this.lastError,
            isLoopRunning: !!this._updateIntervalId
        };
    }
}
