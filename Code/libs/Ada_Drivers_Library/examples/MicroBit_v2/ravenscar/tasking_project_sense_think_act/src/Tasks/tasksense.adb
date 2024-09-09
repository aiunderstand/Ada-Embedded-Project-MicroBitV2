With Ada.Real_Time; use Ada.Real_Time;

package body TaskSense is

    task body sense is
      myClock : Time;
   begin
      
      null; -- note that you can place Setup code here that is only run once for the entire task
      
      loop
         myClock := Clock; --important to get current time such that the period is exactly 200ms.
                           --you need to make sure that the instruction NEVER takes more than this period. 
                           --make sure to measure how long the task needs, see Tasking_Calculate_Execution_Time example in the repository.
                           --What if for some known or unknown reason the execution time becomes larger?
                           --When Worst Case Execution Time (WCET) is overrun so higher than your set period, see : https://www.sigada.org/ada_letters/dec2003/07_Puente_final.pdf
                           --In this template we put the responsiblity on the designer/developer.
         
         delay (0.024); --simulate a sensor eg the ultrasonic sensors needs at least 24ms for 400cm range, replace with your code!!!
                        -- to integrate for example an ultrasonic sensor: copy paste the ultrasonic package for the ultrasonic example to the src directory
                        -- include it using  "with ultrasonic; use ultrasonic". The ultrasonic sensor uses type Distance_CM how can we make that compatible with our Brain.SetMeasurementSensor1?  
         
         Brain.SetMeasurementSensor1 (10); -- random value, hook up a sensor here note that you might need to either cast to integer OR -better- change type of Brain.SetMeasurementSensor1
         Brain.SetMeasurementSensor2 (1); -- random value, hook up another sensor here
            
         delay until myClock + Milliseconds(200); --random period
      end loop;
   end sense;

end TaskSense;
