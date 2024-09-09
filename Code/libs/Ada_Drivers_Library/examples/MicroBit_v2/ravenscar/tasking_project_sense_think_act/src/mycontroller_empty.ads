package MyController_empty is

   type Directions is (Forward, Stop);
   
   task Sense with Priority => 1;
  
   task Think with Priority=> 1; -- what happens for the set direction if think and sense have the same prio and period?
                                 -- what happens if think has a higher priority? Why is think' set direction overwritten by sense' set direction?
   
   task Act with Priority=> 3;

   protected MotorDriver is
      function GetDirection return Directions;
      procedure SetDirection (V : Directions);
   private
      DriveDirection : Directions := Stop;
   end MotorDriver;
end MyController_empty;
