import expect from 'must';

import ApiWay from 'apiway.js';
import testUser from './fixtures/user.json';
import {assertSuccessful, assertArray} from './helpers/callbacks';

describe('Project', function() {
   let apiway;
   let project;
   let data;
   let name = 'Kiosk-API-test'
   let fullName = 'ApiWay/kiosk-API-test'
   let owner = '591282603f4e5bc0b7c454c2'

   before(function() {
      apiway = new ApiWay({
         // username: testUser.USERNAME,
         // password: testUser.PASSWORD,
         // auth: 'basic',
      });
      project = apiway.getProject();
      data = {
         name: name,
         fullName: fullName,
         owner: owner,
         html_url: "https://github.com/ApiWay/Kiosk-API-test",
         provider: "github"
      };
   });

   it('should add a project ', function(done) {
      project.addProject(data, assertSuccessful(done, (err, response) => {
        expect(response.data).to.have.own('projectId')
        done()
      }))
   });

   it('should update project ', function(done) {
      project.updateProject(data, assertSuccessful(done, (err, response) => {
         expect(response.data).to.have.own('projectId')
         done()
         }))
   });

   it('should get project information', function(done) {
     project.updateProject(data, assertSuccessful(done, (err, response) => {
       project.getProject(response.data.projectId, assertSuccessful(done, (err, response) => {
          // console.log("......" + JSON.stringify(response.data))
          expect(response.data).to.have.own('name', name)
          expect(response.data).to.have.own('fullName', fullName)
          expect(response.data).to.have.own('owner', owner)
          done()
       }))
     }))
   });

   it('should get user\'s project list', function(done) {
      project.updateProject(data, assertSuccessful(done, (err, response) => {
        project.getProjectsByUser(owner, assertSuccessful(done, (err, response) => {
          // console.log("......" + JSON.stringify(response.data))
          expect(response.data).to.have.own('projects')
          expect(response.data.projects).to.be.an.array();
          expect(response.data.projects.length).to.be.above(0)
          done()
        }))
      }))
   });
});
