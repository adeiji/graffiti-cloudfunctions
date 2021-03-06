import * as request from "request"
const {google} = require('googleapis')
import * as service_account from "./service-account"
const https = require('https');

export const sendNotification = function (userId:string, activity:string, admin, spotId:string = "") {
  const db = admin.firestore()
  const userCollectionRef:FirebaseFirestore.CollectionReference = db.collection("fcm_tokens")
  return userCollectionRef.doc(userId).get().then(userSnapshot => {
    const token = userSnapshot.data().token    
    console.log(userSnapshot.data())
    let body = {
      message: {
        token: token,
        notification: {        
          body: activity,
          title: "Graffiti"          
        },
        data: {
          spotId: spotId
        }
      }
    }        
    
    getAccessToken().then(access_token => {
      console.log("Access token: " + access_token)

      let options = {
        hostname: "fcm.googleapis.com",
        path: "/v1/projects/graffiti-6cf5a/messages:send",
        method: "POST",                
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + access_token
        }
      }
  
      console.log("HTTP options - " + options)
      
      let notificationRequest = https.request(options, function(resp) {
        resp.setEncoding('utf8');
        resp.on('data', function(data) {
          console.log('Message sent to Firebase for delivery, response:');
          console.log(data);
        });
      });

      notificationRequest.on('error', function(err) {
        console.log('Unable to send message to Firebase');
        console.log(err);
      });

      notificationRequest.write(JSON.stringify(body));
      notificationRequest.end();


    }).catch(error => {
      console.log(error)
      return error
    })
  })
}

function getAccessToken() {
  const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging']

  return new Promise(function(resolve, reject) {
    const key = service_account.key    
    
    const jwtClient = new google.auth.JWT(
      key.client_email,
      null,
      key.private_key,
      SCOPES,
      null
    );
    jwtClient.authorize(function(err, tokens) {
      if (err) {
        reject(err);
        return;
      }
      resolve(tokens.access_token);
    });
  });
}
