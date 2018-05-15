"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request = require("request");
const { google } = require('googleapis');
const service_account = require("./service-account");
exports.sendNotification = function (userId, activity, admin) {
    const db = admin.firestore();
    const userCollectionRef = db.collection("fcm_tokens");
    return userCollectionRef.doc(userId).get().then(userSnapshot => {
        const token = userSnapshot.data().token;
        console.log(userSnapshot.data());
        let body = {
            message: {
                token: token,
                notification: {
                    body: activity,
                    title: "Graffiti"
                }
            }
        };
        getAccessToken().then(access_token => {
            console.log("Access token: " + access_token);
            let options = {
                url: "https://fcm.googleapis.com/v1/projects/graffiti-6cf5a/messages:send",
                method: "POST",
                json: true,
                body: body,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + access_token
                }
            };
            console.log("HTTP options - " + options);
            request(options, function (err, response, responseBody) {
                console.log("Request handled...");
                if (err) {
                    console.log(err); // Retry        
                    return err;
                }
                else if (response.success === 1) {
                    const responseString = "Notification sent to user " + userId + "successfully - " + response.results;
                    return responseString;
                }
                else {
                    console.log(responseBody);
                    return responseBody;
                }
            });
        }).catch(error => {
            console.log(error);
            return error;
        });
    });
};
function getAccessToken() {
    const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];
    return new Promise(function (resolve, reject) {
        const key = service_account.key;
        var jwtClient = new google.auth.JWT(key.client_email, null, key.private_key, SCOPES, null);
        jwtClient.authorize(function (err, tokens) {
            if (err) {
                reject(err);
                return;
            }
            resolve(tokens.access_token);
        });
    });
}
//# sourceMappingURL=notifications.js.map